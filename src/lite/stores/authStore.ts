import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'

// SHA-256 constants
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

function sha256(str: string): string {
  // Convert string to UTF-8 bytes
  const utf8: number[] = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 128) {
      utf8.push(c)
    } else if (c < 2048) {
      utf8.push((c >> 6) | 192)
      utf8.push((c & 63) | 128)
    } else {
      utf8.push((c >> 12) | 224)
      utf8.push(((c >> 6) & 63) | 128)
      utf8.push((c & 63) | 128)
    }
  }

  const m = utf8
  const l = m.length * 8

  // Padding
  m.push(0x80)
  while ((m.length % 64) !== 56) m.push(0)

  // Append length
  for (let i = 7; i >= 0; i--) {
    m.push((l >> (i * 8)) & 0xff)
  }

  // Initial hash values
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  // Helper functions
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  const ch = (x: number, y: number, z: number) => (x & y) ^ (~x & z)
  const maj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z)
  const sigma0 = (x: number) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)
  const sigma1 = (x: number) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)
  const gamma0 = (x: number) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
  const gamma1 = (x: number) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)

  // Process each 64-byte chunk
  for (let i = 0; i < m.length; i += 64) {
    const w: number[] = []

    // Build message schedule
    for (let j = 0; j < 16; j++) {
      w[j] = (m[i + j * 4] << 24) | (m[i + j * 4 + 1] << 16) | (m[i + j * 4 + 2] << 8) | m[i + j * 4 + 3]
    }
    for (let j = 16; j < 64; j++) {
      w[j] = (gamma1(w[j - 2]) + w[j - 7] + gamma0(w[j - 15]) + w[j - 16]) | 0
    }

    // Working variables
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7

    // Compression
    for (let j = 0; j < 64; j++) {
      const t1 = (h + sigma1(e) + ch(e, f, g) + K[j] + w[j]) | 0
      const t2 = (sigma0(a) + maj(a, b, c)) | 0
      h = g; g = f; f = e; e = (d + t1) | 0
      d = c; c = b; b = a; a = (t1 + t2) | 0
    }

    // Update hash
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }

  // Convert to hex
  const toHex = (n: number) => {
    let hex = ''
    for (let i = 7; i >= 0; i--) {
      hex += ((n >> (i * 4)) & 0xf).toString(16)
    }
    return hex
  }

  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7)
}

// Password Hashing (Web Crypto API with fallback)
async function hashPassword(password: string, salt: string): Promise<string> {
  const message = salt + password

  // Try Web Crypto API first (only works in secure contexts)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(message)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    } catch (e) {
      console.log('[Auth] crypto.subtle failed, using fallback')
    }
  }

  // Fallback for non-secure contexts (HTTP)
  console.log('[Auth] Using SHA-256 fallback')
  return sha256(message)
}

// Zufälligen Session-Token generieren
function generateSessionToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

interface User {
  id: string
  username: string
  display_name: string | null
  is_admin: boolean
  role: 'pilot' | 'crew'
}

interface AuthState {
  user: User | null
  sessionToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          console.log('[Auth] Attempting login for:', username)
          const { data, error } = await supabase
            .from('app_users')
            .select('*')
            .eq('username', username)
            .eq('is_active', true)
            .single()

          console.log('[Auth] Response:', { data: data ? 'found' : 'null', error })

          if (error) {
            console.error('[Auth] Supabase error:', error)
            set({ error: `Fehler: ${error.message}`, isLoading: false })
            return false
          }

          if (!data) {
            set({ error: 'Benutzername oder Passwort falsch', isLoading: false })
            return false
          }

          const hash = await hashPassword(password, data.salt)

          if (hash !== data.password_hash) {
            set({ error: 'Benutzername oder Passwort falsch', isLoading: false })
            return false
          }

          // Crew: Wenn auf anderem Gerät eingeloggt, wird das alte Gerät automatisch abgemeldet
          // checkSession() auf dem alten Gerät erkennt den neuen Token und loggt aus
          if (data.role === 'crew' && data.session_token) {
            console.log('[Auth] Crew-Account war auf anderem Gerät aktiv - übernehme Session')
          }

          const user: User = {
            id: data.id,
            username: data.username,
            display_name: data.display_name,
            is_admin: data.is_admin,
            role: data.role || 'pilot'
          }

          // Session-Token generieren und in DB speichern
          const sessionToken = generateSessionToken()
          await supabase
            .from('app_users')
            .update({ session_token: sessionToken })
            .eq('id', data.id)

          set({ user, sessionToken, isAuthenticated: true, isLoading: false, error: null })
          return true
        } catch (err: any) {
          console.error('[Auth] Login error:', err)
          const errorMsg = err?.message || err?.toString() || 'Unbekannter Fehler'
          set({ error: `Verbindungsfehler: ${errorMsg}`, isLoading: false })
          return false
        }
      },

      logout: async () => {
        const { user } = get()
        // Session-Token in DB löschen
        if (user) {
          await supabase.from('app_users').update({ session_token: null }).eq('id', user.id)
          console.log('[Auth] Session-Token gelöscht für:', user.username)
        }
        set({ user: null, sessionToken: null, isAuthenticated: false, error: null })
      },

      checkSession: async () => {
        const { user, isAuthenticated, sessionToken } = get()

        if (!user || !isAuthenticated) {
          set({ isLoading: false })
          return
        }

        // Validiere Session mit Supabase
        try {
          const { data, error } = await supabase
            .from('app_users')
            .select('id, is_active, session_token')
            .eq('id', user.id)
            .single()

          if (error || !data || !data.is_active) {
            set({ user: null, sessionToken: null, isAuthenticated: false, isLoading: false })
            return
          }

          // Prüfe ob Session-Token noch gültig (anderes Gerät hat sich eingeloggt)
          if (sessionToken && data.session_token && data.session_token !== sessionToken) {
            console.log('[Auth] Session von anderem Gerät übernommen - Logout')
            set({ user: null, sessionToken: null, isAuthenticated: false, isLoading: false, error: 'Auf einem anderen Gerät eingeloggt' })
            return
          }

          set({ isLoading: false })
        } catch {
          // Bei Netzwerkfehler: Session beibehalten
          set({ isLoading: false })
        }
      },

      clearError: () => set({ error: null })
    }),
    {
      name: 'nta-lite-auth',
      partialize: (state) => ({
        user: state.user,
        sessionToken: state.sessionToken,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
)
