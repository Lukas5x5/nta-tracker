import { supabase } from '../lib/supabase'
import { useFlightStore } from '../stores/flightStore'

// ============================================
// Profile Sync Service
// ============================================
// Synchronisiert flightStore-Daten (settings, tasks, waypoints, windLines, competitionMaps)
// mit der Supabase user_profiles Tabelle.

let saveTimeoutId: ReturnType<typeof setTimeout> | null = null
let unsubscribeStore: (() => void) | null = null
let currentUserId: string | null = null
let networkHandlers: { online: () => void; offline: () => void } | null = null

const SAVE_DEBOUNCE_MS = 2000
const DIRTY_KEY = 'nta-profile-dirty'
const LAST_USER_KEY = 'nta-last-user-id'

// ============================================
// Load Profile
// ============================================

export async function loadProfile(userId: string): Promise<boolean> {
  currentUserId = userId

  // Prüfen ob ein anderer User sich einloggt - wenn ja, lokale Daten löschen
  const lastUserId = localStorage.getItem(LAST_USER_KEY)
  if (lastUserId && lastUserId !== userId) {
    console.log('[ProfileSync] Anderer User, lösche lokale Daten')
    localStorage.removeItem('nta-flight-storage')
    localStorage.removeItem(DIRTY_KEY)
  }
  localStorage.setItem(LAST_USER_KEY, userId)

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = not found (normal fuer neue User)
      console.warn('[ProfileSync] Profil laden fehlgeschlagen:', error.message)
      // Bei Netzwerkfehler: Lokale Daten behalten!
      console.log('[ProfileSync] Verwende lokale Daten (offline)')
      markDirty()
      startNetworkListeners()
      return false
    }

    if (data) {
      console.log('[ProfileSync] Profil geladen von Supabase')
      applyProfileToStore(data)
      clearDirty()
      return true
    } else {
      console.log('[ProfileSync] Kein Profil gefunden, erstelle aus lokalen Daten...')
      const created = await createInitialProfile(userId)
      if (created) clearDirty()
      else markDirty()
      return created
    }
  } catch (err) {
    console.warn('[ProfileSync] Netzwerkfehler beim Laden:', err)
    // Bei Netzwerkfehler: Lokale Daten BEHALTEN! Nicht löschen!
    console.log('[ProfileSync] Offline-Modus: Verwende lokal gespeicherte Daten')
    markDirty()
    startNetworkListeners()
    return false
  }
}

// ============================================
// Save Profile (debounced)
// ============================================

function scheduleSave(): void {
  if (!currentUserId) return

  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId)
  }

  saveTimeoutId = setTimeout(() => {
    saveTimeoutId = null
    saveProfileNow()
  }, SAVE_DEBOUNCE_MS)
}

async function saveProfileNow(): Promise<boolean> {
  if (!currentUserId) return false

  if (!navigator.onLine) {
    console.log('[ProfileSync] Offline - Aenderungen lokal gespeichert')
    markDirty()
    return false
  }

  const state = useFlightStore.getState()

  try {
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: currentUserId,
        settings: state.settings,
        tasks: state.tasks,
        waypoints: state.waypoints,
        wind_lines: state.windLines,
        competition_maps: state.savedCompetitionMaps,
      }, { onConflict: 'user_id' })

    if (error) {
      console.warn('[ProfileSync] Speichern fehlgeschlagen:', error.message)
      markDirty()
      return false
    }

    console.log('[ProfileSync] Profil gespeichert')
    clearDirty()
    return true
  } catch (err) {
    console.warn('[ProfileSync] Netzwerkfehler beim Speichern:', err)
    markDirty()
    return false
  }
}

// ============================================
// Sync Lifecycle
// ============================================

export function startProfileSync(userId: string): void {
  currentUserId = userId

  // Referenzen fuer Change-Detection (Zustand nutzt immutable Updates)
  let prevTasks = useFlightStore.getState().tasks
  let prevWaypoints = useFlightStore.getState().waypoints
  let prevSettings = useFlightStore.getState().settings
  let prevWindLines = useFlightStore.getState().windLines
  let prevCompetitionMaps = useFlightStore.getState().savedCompetitionMaps

  unsubscribeStore = useFlightStore.subscribe((state) => {
    const changed =
      state.tasks !== prevTasks ||
      state.waypoints !== prevWaypoints ||
      state.settings !== prevSettings ||
      state.windLines !== prevWindLines ||
      state.savedCompetitionMaps !== prevCompetitionMaps

    if (changed) {
      prevTasks = state.tasks
      prevWaypoints = state.waypoints
      prevSettings = state.settings
      prevWindLines = state.windLines
      prevCompetitionMaps = state.savedCompetitionMaps
      scheduleSave()
    }
  })

  startNetworkListeners()

  // Dirty-Flag von vorheriger Offline-Session pruefen
  if (isDirtyFromStorage()) {
    console.log('[ProfileSync] Unsynchronisierte Aenderungen gefunden, synchronisiere...')
    saveProfileNow()
  }

  console.log('[ProfileSync] Profil-Synchronisation gestartet')
}

export async function stopProfileSync(): Promise<void> {
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId)
    saveTimeoutId = null
  }

  // Letzter Save-Versuch
  if (currentUserId && navigator.onLine) {
    await saveProfileNow()
  }

  if (unsubscribeStore) {
    unsubscribeStore()
    unsubscribeStore = null
  }

  stopNetworkListeners()
  currentUserId = null
  console.log('[ProfileSync] Profil-Synchronisation gestoppt')
}

// ============================================
// Apply Profile to Store
// ============================================

function applyProfileToStore(profile: any): void {
  const currentSettings = useFlightStore.getState().settings

  // Merge: aktuelle Defaults + gespeicherte Settings
  // So bekommen neue Settings-Felder (nach App-Update) ihre Defaults
  const mergedSettings = {
    ...currentSettings,
    ...(profile.settings || {}),
  }

  useFlightStore.setState({
    settings: mergedSettings,
    tasks: profile.tasks || [],
    waypoints: profile.waypoints || [],
    windLines: profile.wind_lines || [],
    savedCompetitionMaps: profile.competition_maps || [],
    activeCompetitionMap: null,
    activeTask: null,
    selectedGoal: null,
  })
}

// ============================================
// Create Initial Profile
// ============================================

async function createInitialProfile(userId: string): Promise<boolean> {
  const state = useFlightStore.getState()

  try {
    const { error } = await supabase
      .from('user_profiles')
      .insert({
        user_id: userId,
        settings: state.settings,
        tasks: state.tasks,
        waypoints: state.waypoints,
        wind_lines: state.windLines,
        competition_maps: state.savedCompetitionMaps,
      })

    if (error) {
      console.warn('[ProfileSync] Profil erstellen fehlgeschlagen:', error.message)
      return false
    }

    console.log('[ProfileSync] Initiales Profil erstellt')
    return true
  } catch (err) {
    console.warn('[ProfileSync] Netzwerkfehler beim Erstellen:', err)
    return false
  }
}

// ============================================
// Dirty Flag
// ============================================

function markDirty(): void {
  try { localStorage.setItem(DIRTY_KEY, 'true') } catch { /* ignore */ }
}

function clearDirty(): void {
  try { localStorage.removeItem(DIRTY_KEY) } catch { /* ignore */ }
}

function isDirtyFromStorage(): boolean {
  try { return localStorage.getItem(DIRTY_KEY) === 'true' } catch { return false }
}

// ============================================
// Clear Local Flight Data (fuer Multi-User)
// ============================================
// HINWEIS: Diese Funktion löscht NICHT mehr die lokalen Daten beim Logout,
// damit Offline-Login weiterhin funktioniert. Die Daten werden nur gelöscht,
// wenn sich ein ANDERER User einloggt (siehe loadProfile).

export function clearLocalFlightData(): void {
  // Lokale Daten werden NICHT mehr gelöscht beim Logout!
  // Das ermöglicht Offline-Login mit den zuletzt gespeicherten Daten.
  // Die Daten werden nur in loadProfile() gelöscht wenn sich ein anderer User einloggt.
  console.log('[ProfileSync] Logout - lokale Daten bleiben erhalten für Offline-Zugriff')
}

// ============================================
// Network Listeners
// ============================================

function startNetworkListeners(): void {
  if (networkHandlers) return

  networkHandlers = {
    online: () => {
      console.log('[ProfileSync] Wieder online - synchronisiere...')
      if (currentUserId && isDirtyFromStorage()) {
        saveProfileNow()
      }
    },
    offline: () => {
      console.log('[ProfileSync] Offline')
    }
  }

  window.addEventListener('online', networkHandlers.online)
  window.addEventListener('offline', networkHandlers.offline)
}

function stopNetworkListeners(): void {
  if (networkHandlers) {
    window.removeEventListener('online', networkHandlers.online)
    window.removeEventListener('offline', networkHandlers.offline)
    networkHandlers = null
  }
}
