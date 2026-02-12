import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface Team {
  id: string
  name: string
  join_code: string
  created_at: string
  is_active: boolean
}

// Vereinfachte Task-Struktur für Lite-Version
export interface PilotTask {
  id: string
  type: string
  name: string
  taskNumber?: string
  goals: {
    id: string
    name: string
    position: { latitude: number; longitude: number }
    radius: number
  }[]
  rings?: number[]
  mmaRadius?: number
  isActive: boolean
}

export interface PilotPosition {
  memberId: string
  userId: string | null   // Für Task-Laden
  callsign: string
  color: string
  role: 'pilot' | 'crew'
  latitude: number
  longitude: number
  altitude: number      // in meters
  heading: number       // in degrees
  speed: number         // in m/s
  vario: number         // in m/s
  timestamp: Date
  isOnline: boolean
}

interface TrackerState {
  // Team
  team: Team | null
  joinCode: string
  joinError: string | null
  isJoining: boolean

  // Pilots
  pilots: PilotPosition[]
  selectedPilot: string | null
  isTracking: boolean

  // Selected Pilot Tasks
  pilotTasks: PilotTask[]
  loadingTasks: boolean

  // Actions
  joinTeam: (joinCode: string) => Promise<boolean>
  leaveTeam: () => void
  selectPilot: (memberId: string | null) => void
  loadPilotTasks: (memberId: string) => Promise<void>
}

let positionsChannel: RealtimeChannel | null = null
let membersChannel: RealtimeChannel | null = null
let presenceChannel: RealtimeChannel | null = null
let tasksChannel: RealtimeChannel | null = null

export const useTrackerStore = create<TrackerState>((set, get) => ({
  team: null,
  joinCode: '',
  joinError: null,
  isJoining: false,

  pilots: [],
  selectedPilot: null,
  isTracking: false,

  pilotTasks: [],
  loadingTasks: false,

  joinTeam: async (joinCode: string) => {
    set({ isJoining: true, joinError: null, joinCode })

    try {
      // Team suchen
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('join_code', joinCode)
        .eq('is_active', true)
        .single()

      if (teamError || !team) {
        set({ isJoining: false, joinError: 'Team nicht gefunden oder nicht mehr aktiv.' })
        return false
      }

      console.log('[Tracker] Team gefunden:', team.name)

      // Team Members laden (mit app_users.role über user_id Join)
      const { data: members, error: membersError } = await supabase
        .from('team_members')
        .select('*, app_users(role)')
        .eq('team_id', team.id)

      if (membersError) {
        console.error('[Tracker] Members laden fehlgeschlagen:', membersError)
      }

      // Helper: Rolle ermitteln - app_users.role hat Priorität (team_members.role kann veraltet sein)
      const getMemberRole = (m: any): 'pilot' | 'crew' => {
        if (m.app_users?.role === 'crew' || m.app_users?.role === 'pilot') return m.app_users.role
        if (m.role === 'crew' || m.role === 'pilot') return m.role
        return 'pilot'
      }

      // Initiale Piloten-Liste aus Members
      const pilots: PilotPosition[] = (members || []).map((m: any) => ({
        memberId: m.id,
        userId: m.user_id || null,
        callsign: m.callsign,
        color: m.color || '#3b82f6',
        role: getMemberRole(m),
        latitude: 0,
        longitude: 0,
        altitude: 0,
        heading: 0,
        speed: 0,
        vario: 0,
        timestamp: new Date(m.last_seen || m.joined_at),
        isOnline: m.is_online || false
      }))

      set({
        team: {
          id: team.id,
          name: team.name,
          join_code: team.join_code,
          created_at: team.created_at,
          is_active: team.is_active
        },
        pilots,
        isJoining: false,
        isTracking: true
      })

      // Realtime Subscriptions starten
      startRealtimeSubscriptions(team.id)

      // Letzte Positionen laden
      await loadLatestPositions(team.id)

      return true
    } catch (err) {
      console.error('[Tracker] Join error:', err)
      set({ isJoining: false, joinError: 'Verbindungsfehler. Bitte erneut versuchen.' })
      return false
    }
  },

  leaveTeam: () => {
    // Channels aufräumen
    if (positionsChannel) {
      supabase.removeChannel(positionsChannel)
      positionsChannel = null
    }
    if (membersChannel) {
      supabase.removeChannel(membersChannel)
      membersChannel = null
    }
    if (presenceChannel) {
      supabase.removeChannel(presenceChannel)
      presenceChannel = null
    }
    if (tasksChannel) {
      supabase.removeChannel(tasksChannel)
      tasksChannel = null
    }

    set({
      team: null,
      pilots: [],
      selectedPilot: null,
      isTracking: false,
      joinCode: '',
      joinError: null,
      pilotTasks: [],
      loadingTasks: false
    })
  },

  selectPilot: (memberId) => {
    set({ selectedPilot: memberId })
    // Tasks laden wenn Pilot ausgewählt
    if (memberId) {
      set({ pilotTasks: [], loadingTasks: true })
      get().loadPilotTasks(memberId)
    } else {
      set({ pilotTasks: [], loadingTasks: false })
    }
  },

  loadPilotTasks: async (memberId: string) => {
    const pilot = get().pilots.find(p => p.memberId === memberId)
    if (!pilot?.userId) {
      console.log('[Tracker] Pilot hat keine user_id, Tasks können nicht geladen werden')
      set({ pilotTasks: [], loadingTasks: false })
      return
    }

    set({ loadingTasks: true })

    try {
      // User Profile mit Tasks laden
      const { data, error } = await supabase
        .from('user_profiles')
        .select('tasks')
        .eq('user_id', pilot.userId)
        .single()

      if (error || !data) {
        console.log('[Tracker] Keine Tasks gefunden für User:', pilot.userId)
        set({ pilotTasks: [], loadingTasks: false })
        return
      }

      console.log('[Tracker] Raw tasks from DB:', data.tasks?.length, 'tasks')
      console.log('[Tracker] ALL tasks:', JSON.stringify(data.tasks, null, 2))

      // Tasks parsen - ALLE Tasks anzeigen (kein Filter auf isActive)
      const tasks: PilotTask[] = (data.tasks || [])
        .map((t: any) => {
          console.log('[Tracker] Processing task:', t.name, 'Type:', t.type)
          console.log('[Tracker] Task data:', JSON.stringify(t, null, 2))

          // Goals sammeln aus verschiedenen Quellen
          const goals: any[] = []

          // 1. Explizite Goals
          if (t.goals && Array.isArray(t.goals)) {
            t.goals.forEach((g: any, idx: number) => {
              const lat = g.position?.latitude ?? g.latitude
              const lng = g.position?.longitude ?? g.longitude
              if (lat && lng) {
                // Radius: Task mmaRadius hat Priorität, dann goal.radius als Fallback
                const radius = t.mmaRadius ?? g.radius ?? 100
                console.log('[Tracker] Goal from goals[]:', g.name, 'lat:', lat, 'lng:', lng, 'radius:', radius, 'mmaRadius:', t.mmaRadius)
                goals.push({
                  id: g.id || `goal-${idx}`,
                  name: g.name || `Goal ${idx + 1}`,
                  position: { latitude: lat, longitude: lng },
                  radius: radius
                })
              }
            })
          }

          // 2. Reference Point als Goal (für XDI, MDT, etc.)
          if (t.referencePoint?.latitude && t.referencePoint?.longitude) {
            console.log('[Tracker] Goal from referencePoint:', t.referencePoint)
            goals.push({
              id: 'ref-point',
              name: 'Reference Point',
              position: { latitude: t.referencePoint.latitude, longitude: t.referencePoint.longitude },
              radius: t.mmaRadius || 100
            })
          }

          // 3. Scoring Area Center als Goal (für GBM, RTA, etc.)
          if (t.scoringArea?.center?.latitude && t.scoringArea?.center?.longitude) {
            console.log('[Tracker] Goal from scoringArea:', t.scoringArea.center)
            goals.push({
              id: 'scoring-center',
              name: 'Scoring Area',
              position: { latitude: t.scoringArea.center.latitude, longitude: t.scoringArea.center.longitude },
              radius: t.scoringArea.radius || 500
            })
          }

          console.log('[Tracker] Total goals for task:', goals.length)

          return {
            id: t.id,
            type: t.type,
            name: t.name,
            taskNumber: t.taskNumber,
            goals,
            rings: t.rings || [],
            mmaRadius: t.mmaRadius ?? 0,
            isActive: t.isActive
          }
        })

      console.log('[Tracker] Total active tasks:', tasks.length)
      set({ pilotTasks: tasks, loadingTasks: false })
    } catch (err) {
      console.error('[Tracker] Fehler beim Laden der Tasks:', err)
      set({ pilotTasks: [], loadingTasks: false })
    }
  }
}))

function startRealtimeSubscriptions(teamId: string) {
  const store = useTrackerStore

  // 1. Positions Updates
  positionsChannel = supabase
    .channel(`tracker-positions-${teamId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'positions',
        filter: `team_id=eq.${teamId}`
      },
      (payload) => {
        const pos = payload.new as any
        console.log('[Tracker] Position update für:', pos.member_id)

        store.setState(state => {
          const existingIndex = state.pilots.findIndex(p => p.memberId === pos.member_id)

          const updatedPilot: PilotPosition = {
            memberId: pos.member_id,
            callsign: existingIndex >= 0 ? state.pilots[existingIndex].callsign : `Pilot`,
            color: existingIndex >= 0 ? state.pilots[existingIndex].color : '#3b82f6',
            role: existingIndex >= 0 ? state.pilots[existingIndex].role : 'pilot',
            latitude: pos.latitude,
            longitude: pos.longitude,
            altitude: pos.altitude || 0,
            heading: pos.heading || 0,
            speed: pos.speed || 0,
            vario: pos.vario || 0,
            timestamp: new Date(pos.recorded_at || Date.now()),
            isOnline: true
          }

          if (existingIndex >= 0) {
            const newPilots = [...state.pilots]
            newPilots[existingIndex] = {
              ...newPilots[existingIndex],
              ...updatedPilot
            }
            return { pilots: newPilots }
          } else {
            return { pilots: [...state.pilots, updatedPilot] }
          }
        })
      }
    )
    .subscribe()

  // 2. Member Changes (Join/Leave)
  membersChannel = supabase
    .channel(`tracker-members-${teamId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'team_members',
        filter: `team_id=eq.${teamId}`
      },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const m = payload.new as any
          console.log('[Tracker] Neuer Pilot:', m.callsign)

          // Rolle ermitteln: immer aus app_users nachladen (team_members.role kann Default 'pilot' sein)
          let memberRole: 'pilot' | 'crew' = m.role || 'pilot'
          if (m.user_id) {
            // Rolle async aus app_users nachladen (hat Priorität)
            supabase.from('app_users').select('role').eq('id', m.user_id).single().then(({ data }) => {
              if (data?.role) {
                console.log(`[Tracker] Realtime: Rolle für ${m.callsign} aus app_users: ${data.role}`)
                store.setState(state => ({
                  pilots: state.pilots.map(p =>
                    p.memberId === m.id ? { ...p, role: data.role } : p
                  )
                }))
              }
            })
          }

          store.setState(state => {
            // Duplikate verhindern: existierende Einträge mit gleicher ID oder gleichem Callsign entfernen
            const filtered = state.pilots.filter(p =>
              p.memberId !== m.id && p.callsign !== m.callsign
            )

            return {
              pilots: [...filtered, {
                memberId: m.id,
                userId: m.user_id || null,
                callsign: m.callsign,
                color: m.color || '#3b82f6',
                role: memberRole,
                latitude: 0,
                longitude: 0,
                altitude: 0,
                heading: 0,
                speed: 0,
                vario: 0,
                timestamp: new Date(),
                isOnline: true
              }]
            }
          })
        }

        if (payload.eventType === 'DELETE') {
          const old = payload.old as any
          console.log('[Tracker] Pilot hat verlassen:', old.id)

          store.setState(state => ({
            pilots: state.pilots.filter(p => p.memberId !== old.id),
            selectedPilot: state.selectedPilot === old.id ? null : state.selectedPilot
          }))
        }

        if (payload.eventType === 'UPDATE') {
          const m = payload.new as any
          store.setState(state => ({
            pilots: state.pilots.map(p =>
              p.memberId === m.id
                ? { ...p, callsign: m.callsign, color: m.color || p.color, isOnline: m.is_online }
                : p
            )
          }))
        }
      }
    )
    .subscribe()

  // 3. Presence für Online/Offline Status
  presenceChannel = supabase
    .channel(`tracker-presence-${teamId}`)
    .on('presence', { event: 'sync' }, () => {
      const presenceState = presenceChannel!.presenceState()
      const onlineIds = new Set<string>()

      Object.values(presenceState).forEach((users: any) => {
        users.forEach((u: any) => {
          if (u.member_id) onlineIds.add(u.member_id)
        })
      })

      store.setState(state => ({
        pilots: state.pilots.map(p => ({
          ...p,
          isOnline: onlineIds.has(p.memberId)
        }))
      }))
    })
    .subscribe()

  // 4. User Profiles (Tasks) - Änderungen an Tasks live mitbekommen
  tasksChannel = supabase
    .channel(`tracker-tasks-${teamId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_profiles'
      },
      (payload) => {
        const profile = payload.new as any
        const state = store.getState()
        const { selectedPilot, pilots } = state

        // Prüfen ob das Update den aktuell ausgewählten Piloten betrifft
        if (selectedPilot) {
          const pilot = pilots.find(p => p.memberId === selectedPilot)
          if (pilot?.userId && pilot.userId === profile.user_id) {
            console.log('[Tracker] Tasks-Update für ausgewählten Piloten:', pilot.callsign)
            state.loadPilotTasks(selectedPilot)
          }
        }
      }
    )
    .subscribe()

  // Stale Check alle 30 Sekunden
  setInterval(() => {
    const now = Date.now()
    store.setState(state => ({
      pilots: state.pilots.map(p => {
        const posTime = p.timestamp.getTime()
        const isOnline = (now - posTime) < 120000 // 2 Minuten
        return { ...p, isOnline }
      })
    }))
  }, 30000)
}

async function loadLatestPositions(teamId: string) {
  try {
    // Lade die neuesten Positionen für jeden Member
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('team_id', teamId)
      .order('recorded_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[Tracker] Positionen laden fehlgeschlagen:', error)
      return
    }

    // Gruppiere nach member_id, behalte nur die neueste Position
    const latestByMember = new Map<string, any>()
    for (const pos of data || []) {
      if (!latestByMember.has(pos.member_id)) {
        latestByMember.set(pos.member_id, pos)
      }
    }

    // Update Piloten mit ihren letzten Positionen
    useTrackerStore.setState(state => ({
      pilots: state.pilots.map(pilot => {
        const pos = latestByMember.get(pilot.memberId)
        if (!pos) return pilot

        return {
          ...pilot,
          latitude: pos.latitude,
          longitude: pos.longitude,
          altitude: pos.altitude || 0,
          heading: pos.heading || 0,
          speed: pos.speed || 0,
          vario: pos.vario || 0,
          timestamp: new Date(pos.recorded_at)
        }
      })
    }))

    console.log('[Tracker] Positionen geladen für', latestByMember.size, 'Piloten')
  } catch (err) {
    console.error('[Tracker] Fehler beim Laden der Positionen:', err)
  }
}
