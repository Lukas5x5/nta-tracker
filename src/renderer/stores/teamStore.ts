import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from './authStore'
import {
  TeamConnectionStatus, TEAM_MEMBER_COLORS, WindSource
} from '../../shared/types'
import type {
  TeamSession, TeamMember, TeamPosition, QueuedPosition, WindLayer
} from '../../shared/types'

// Geteiltes Windprofil von einem Team-Member
export interface TeamWindProfile {
  memberId: string
  callsign: string
  color: string
  windLayers: WindLayer[]
  sharedAt: Date
}

// Trackpunkt mit allen Flugdaten
export interface TrackPoint {
  latitude: number
  longitude: number
  altitude: number
  heading: number
  speed: number
  vario: number
  recordedAt: Date
}

// Erweiterter TeamMember mit aktueller Position und Track
export interface TeamMemberWithTrack extends TeamMember {
  currentPosition: TeamPosition | null
  track: [number, number][] // lat/lon Trail für Polyline (max 500 Punkte)
  trackPoints: TrackPoint[] // Volle Trackdaten mit Höhe, Speed etc.
}

// Team-Nachricht
export interface TeamMessage {
  id: string
  memberId: string
  callsign: string
  color: string
  message: string
  createdAt: Date
  isMine?: boolean
  targetMemberId?: string | null // null = All Chat, string = Private Message
  targetCallsign?: string | null
}

const QUEUE_KEY = 'nta_team_position_queue'
const MAX_TRACK_POINTS = 50000

interface TeamState {
  // Session
  session: TeamSession | null
  myMemberId: string | null
  members: TeamMemberWithTrack[]

  // Connection
  connectionStatus: TeamConnectionStatus
  error: string | null

  // Offline Queue
  queue: QueuedPosition[]

  // Visibility
  hiddenMembers: Set<string>

  // Messages
  messages: TeamMessage[]

  // Team Wind Profiles (geteilte Windprofile von anderen Teammitgliedern)
  teamWindProfiles: TeamWindProfile[]

  // Channel References (für Cleanup)
  _channels: any[] | null
  _windChannel: any | null

  // Actions
  createTeam: (callsign: string, teamName?: string) => Promise<string | null>
  joinTeam: (joinCode: string, callsign: string) => Promise<boolean>
  leaveTeam: () => Promise<void>
  sendPosition: (lat: number, lon: number, alt: number, heading: number, speed: number, vario: number) => void
  sendMessage: (message: string, targetMemberId?: string | null) => Promise<boolean>
  shareWindProfile: (windLayers: WindLayer[]) => void
  flushQueue: () => Promise<void>
  setConnectionStatus: (status: TeamConnectionStatus) => void
  toggleMemberVisibility: (memberId: string) => void
  clearMessages: () => void
  cleanup: () => void
}

// Generiere 6-stelligen Code
function generateJoinCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Wähle Farbe basierend auf Member-Index
function pickColor(existingMembers: TeamMember[]): string {
  const usedColors = new Set(existingMembers.map(m => m.color))
  for (const color of TEAM_MEMBER_COLORS) {
    if (!usedColors.has(color)) return color
  }
  return TEAM_MEMBER_COLORS[existingMembers.length % TEAM_MEMBER_COLORS.length]
}

// Lade Queue aus localStorage
function loadQueue(): QueuedPosition[] {
  try {
    const data = localStorage.getItem(QUEUE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

// Speichere Queue in localStorage
function saveQueue(queue: QueuedPosition[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Storage voll
  }
}

export const useTeamStore = create<TeamState>((set, get) => ({
  session: null,
  myMemberId: null,
  members: [],
  connectionStatus: TeamConnectionStatus.Disconnected,
  error: null,
  queue: loadQueue(),
  hiddenMembers: new Set<string>(),
  messages: [],
  teamWindProfiles: [],
  _channels: null,
  _windChannel: null,

  createTeam: async (callsign: string, teamName?: string) => {
    if (!isSupabaseConfigured()) {
      set({ error: 'Supabase nicht konfiguriert. Bitte URL und Key in src/renderer/lib/supabase.ts eintragen.' })
      return null
    }

    set({ connectionStatus: TeamConnectionStatus.Connecting, error: null })

    try {
      const joinCode = generateJoinCode()

      // Team erstellen
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .insert({
          join_code: joinCode,
          name: teamName || `Team ${callsign}`,
          is_active: true,
          max_members: 20
        })
        .select()
        .single()

      if (teamError || !team) {
        set({ connectionStatus: TeamConnectionStatus.Error, error: `Team erstellen fehlgeschlagen: ${teamError?.message}` })
        return null
      }

      // Sich selbst als Member hinzufügen (mit user_id für Task-Sharing)
      const color = TEAM_MEMBER_COLORS[0]
      const currentUser = useAuthStore.getState().user
      const myRole = currentUser?.role || 'pilot'
      const { data: member, error: memberError } = await supabase
        .from('team_members')
        .insert({
          team_id: team.id,
          user_id: currentUser?.id || null,
          callsign,
          color,
          is_online: true,
          role: myRole
        })
        .select()
        .single()

      if (memberError || !member) {
        set({ connectionStatus: TeamConnectionStatus.Error, error: `Member erstellen fehlgeschlagen: ${memberError?.message}` })
        return null
      }

      const session: TeamSession = {
        id: team.id,
        joinCode: team.join_code,
        name: team.name,
        createdAt: new Date(team.created_at),
        expiresAt: new Date(team.expires_at),
        isActive: true,
        maxMembers: team.max_members
      }

      const myMember: TeamMemberWithTrack = {
        id: member.id,
        teamId: team.id,
        callsign: member.callsign,
        color: member.color,
        role: member.role || 'pilot',
        joinedAt: new Date(member.joined_at),
        lastSeen: new Date(),
        isOnline: true,
        currentPosition: null,
        track: [],
        trackPoints: []
      }

      set({
        session,
        myMemberId: member.id,
        members: [myMember],
        connectionStatus: TeamConnectionStatus.Connected,
        error: null
      })

      // Realtime Subscriptions starten
      subscribeToTeam(team.id, member.id)

      // Netzwerk-Listener starten
      startNetworkListeners()

      // Queue flushen falls vorhanden
      if (get().queue.length > 0) {
        get().flushQueue()
      }

      return joinCode
    } catch (e: any) {
      set({ connectionStatus: TeamConnectionStatus.Error, error: e.message })
      return null
    }
  },

  joinTeam: async (joinCode: string, callsign: string) => {
    if (!isSupabaseConfigured()) {
      set({ error: 'Supabase nicht konfiguriert. Bitte URL und Key in src/renderer/lib/supabase.ts eintragen.' })
      return false
    }

    set({ connectionStatus: TeamConnectionStatus.Connecting, error: null })

    try {
      // Team suchen
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('join_code', joinCode)
        .eq('is_active', true)
        .single()

      if (teamError || !team) {
        set({ connectionStatus: TeamConnectionStatus.Error, error: 'Team nicht gefunden oder abgelaufen.' })
        return false
      }

      // Bestehende Members laden (mit app_users.role über user_id Join)
      const { data: existingMembers } = await supabase
        .from('team_members')
        .select('*, app_users(role)')
        .eq('team_id', team.id)

      console.log('[Team] Existing members raw data:', JSON.stringify(existingMembers, null, 2))

      // Helper: Rolle ermitteln - app_users.role hat Priorität (team_members.role kann veraltet sein)
      const getMemberRole = (m: any): 'pilot' | 'crew' => {
        const appUserRole = m.app_users?.role
        const memberRole = m.role
        console.log(`[Team] getMemberRole for ${m.callsign}: team_members.role=${memberRole}, app_users.role=${appUserRole}`)
        // Priorität 1: Rolle aus app_users Join (die "wahre" Rolle des Users)
        if (appUserRole === 'crew' || appUserRole === 'pilot') return appUserRole
        // Priorität 2: Rolle aus team_members
        if (memberRole === 'crew' || memberRole === 'pilot') return memberRole
        return 'pilot'
      }

      // Rollen-basierte Limit-Prüfung (max 10 Piloten + 10 Crew)
      const currentUser = useAuthStore.getState().user
      const myRole = currentUser?.role || 'pilot'
      if (existingMembers) {
        const pilotCount = existingMembers.filter((m: any) => getMemberRole(m) === 'pilot').length
        const crewCount = existingMembers.filter((m: any) => getMemberRole(m) === 'crew').length

        if (myRole === 'pilot' && pilotCount >= 10) {
          set({ connectionStatus: TeamConnectionStatus.Error, error: 'Team ist voll (max. 10 Piloten).' })
          return false
        }
        if (myRole === 'crew' && crewCount >= 10) {
          set({ connectionStatus: TeamConnectionStatus.Error, error: 'Team ist voll (max. 10 Crew).' })
          return false
        }
      }

      // Prüfen ob bereits ein Eintrag mit gleicher user_id oder gleichem callsign existiert (z.B. nach App-Neustart)
      let member: any = null
      let memberError: any = null

      if (currentUser?.id) {
        const existingEntry = (existingMembers || []).find((m: any) =>
          m.user_id === currentUser.id || m.callsign === callsign
        )

        if (existingEntry) {
          // Alten Eintrag reaktivieren statt neuen anlegen
          console.log('[Team] Rejoin: Bestehenden Member-Eintrag reaktivieren:', existingEntry.id)
          const { data, error } = await supabase
            .from('team_members')
            .update({
              callsign,
              is_online: true,
              role: myRole,
              last_seen: new Date().toISOString()
            })
            .eq('id', existingEntry.id)
            .select()
            .single()

          member = data
          memberError = error
        }
      }

      // Kein bestehender Eintrag gefunden → neu einfügen
      if (!member) {
        const color = pickColor((existingMembers || []) as TeamMember[])
        const { data, error } = await supabase
          .from('team_members')
          .insert({
            team_id: team.id,
            user_id: currentUser?.id || null,
            callsign,
            color,
            is_online: true,
            role: myRole
          })
          .select()
          .single()

        member = data
        memberError = error
      }

      if (memberError || !member) {
        const msg = memberError?.message?.includes('unique')
          ? 'Callsign bereits im Team vergeben.'
          : `Beitreten fehlgeschlagen: ${memberError?.message}`
        set({ connectionStatus: TeamConnectionStatus.Error, error: msg })
        return false
      }

      const session: TeamSession = {
        id: team.id,
        joinCode: team.join_code,
        name: team.name,
        createdAt: new Date(team.created_at),
        expiresAt: new Date(team.expires_at),
        isActive: true,
        maxMembers: team.max_members
      }

      // Alle Members als TeamMemberWithTrack aufbauen (eigenen Eintrag ausschließen, wird separat hinzugefügt)
      const allMembers: TeamMemberWithTrack[] = (existingMembers || [])
        .filter((m: any) => m.id !== member.id)
        .map((m: any) => ({
          id: m.id,
          teamId: m.team_id,
          callsign: m.callsign,
          color: m.color,
          role: getMemberRole(m),
          joinedAt: new Date(m.joined_at),
          lastSeen: new Date(m.last_seen),
          isOnline: m.is_online,
          currentPosition: null,
          track: [],
          trackPoints: []
        }))

      // Eigenen Member hinzufügen
      allMembers.push({
        id: member.id,
        teamId: team.id,
        callsign: member.callsign,
        color: member.color,
        role: member.role || 'pilot',
        joinedAt: new Date(member.joined_at),
        lastSeen: new Date(),
        isOnline: true,
        currentPosition: null,
        track: [],
        trackPoints: []
      })

      set({
        session,
        myMemberId: member.id,
        members: allMembers,
        connectionStatus: TeamConnectionStatus.Connected,
        error: null
      })

      // Realtime Subscriptions starten
      subscribeToTeam(team.id, member.id)
      startNetworkListeners()

      if (get().queue.length > 0) {
        get().flushQueue()
      }

      return true
    } catch (e: any) {
      set({ connectionStatus: TeamConnectionStatus.Error, error: e.message })
      return false
    }
  },

  leaveTeam: async () => {
    const { session, myMemberId } = get()

    // Channels aufräumen
    get().cleanup()

    // Member aus DB entfernen
    if (session && myMemberId) {
      try {
        await supabase
          .from('team_members')
          .delete()
          .eq('id', myMemberId)
      } catch {
        // Ignorieren
      }
    }

    set({
      session: null,
      myMemberId: null,
      members: [],
      connectionStatus: TeamConnectionStatus.Disconnected,
      error: null,
      queue: [],
      hiddenMembers: new Set<string>(),
      messages: [],
      teamWindProfiles: [],
      _channels: null,
      _windChannel: null
    })

    localStorage.removeItem(QUEUE_KEY)
    stopNetworkListeners()
  },

  sendPosition: (lat, lon, alt, heading, speed, vario) => {
    const { session, myMemberId } = get()
    if (!session || !myMemberId) return

    const recordedAt = new Date().toISOString()

    if (!navigator.onLine) {
      // Offline: In Queue speichern
      const queueEntry: QueuedPosition = {
        latitude: lat, longitude: lon, altitude: alt,
        heading, speed, vario, recordedAt
      }
      const newQueue = [...get().queue, queueEntry]
      set({ queue: newQueue, connectionStatus: TeamConnectionStatus.Offline })
      saveQueue(newQueue)
      return
    }

    // Online: Direkt senden
    supabase.from('positions').insert({
      team_id: session.id,
      member_id: myMemberId,
      latitude: lat,
      longitude: lon,
      altitude: alt,
      heading,
      speed,
      vario,
      recorded_at: recordedAt,
      is_queued: false
    }).then(({ error }) => {
      if (error) {
        // Fehler beim Senden → in Queue
        const queueEntry: QueuedPosition = {
          latitude: lat, longitude: lon, altitude: alt,
          heading, speed, vario, recordedAt
        }
        const newQueue = [...get().queue, queueEntry]
        set({ queue: newQueue, connectionStatus: TeamConnectionStatus.Offline })
        saveQueue(newQueue)
      }
    })
  },

  sendMessage: async (message: string, targetMemberId?: string | null) => {
    const { session, myMemberId, members } = get()
    if (!session || !myMemberId) return false

    try {
      const { data, error } = await supabase.from('team_messages').insert({
        team_id: session.id,
        member_id: myMemberId,
        message,
        target_member_id: targetMemberId || null
      }).select('id, created_at').single()

      if (!error && data) {
        // Eigene Nachricht sofort lokal anzeigen (Realtime ignoriert eigene)
        const me = members.find(m => m.id === myMemberId)
        const target = targetMemberId ? members.find(m => m.id === targetMemberId) : null
        const myMsg: TeamMessage = {
          id: data.id,
          memberId: myMemberId,
          callsign: me?.callsign || 'Ich',
          color: me?.color || '#ffffff',
          message,
          createdAt: new Date(data.created_at),
          isMine: true,
          targetMemberId: targetMemberId || null,
          targetCallsign: target?.callsign || null
        }
        set(state => ({ messages: [...state.messages, myMsg] }))
      }
      return !error
    } catch {
      return false
    }
  },

  shareWindProfile: (windLayers: WindLayer[]) => {
    const { session, myMemberId, members, _windChannel } = get()
    if (!session || !myMemberId || !_windChannel) return

    const me = members.find(m => m.id === myMemberId)
    if (!me) return

    // Windprofil über Broadcast Channel senden
    _windChannel.send({
      type: 'broadcast',
      event: 'wind_profile',
      payload: {
        memberId: myMemberId,
        callsign: me.callsign,
        color: me.color,
        windLayers: windLayers.map(w => ({
          altitude: w.altitude,
          direction: w.direction,
          speed: w.speed,
          timestamp: w.timestamp instanceof Date ? w.timestamp.toISOString() : w.timestamp,
          source: w.source,
          isStable: w.isStable,
          stableSince: w.stableSince instanceof Date ? w.stableSince.toISOString() : w.stableSince,
          vario: w.vario
        })),
        sharedAt: new Date().toISOString()
      }
    })
  },

  flushQueue: async () => {
    const { queue, session, myMemberId } = get()
    if (queue.length === 0 || !session || !myMemberId) return

    set({ connectionStatus: TeamConnectionStatus.Syncing })

    const positions = queue.map(q => ({
      team_id: session.id,
      member_id: myMemberId,
      latitude: q.latitude,
      longitude: q.longitude,
      altitude: q.altitude,
      heading: q.heading,
      speed: q.speed,
      vario: q.vario,
      recorded_at: q.recordedAt,
      is_queued: true
    }))

    const { error } = await supabase.from('positions').insert(positions)

    if (!error) {
      set({ queue: [], connectionStatus: TeamConnectionStatus.Connected })
      localStorage.removeItem(QUEUE_KEY)
    } else {
      set({ connectionStatus: TeamConnectionStatus.Offline, error: 'Sync fehlgeschlagen, wird erneut versucht...' })
      // Retry in 5 Sekunden
      setTimeout(() => get().flushQueue(), 5000)
    }
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  toggleMemberVisibility: (memberId) => set(state => {
    const newHidden = new Set(state.hiddenMembers)
    if (newHidden.has(memberId)) {
      newHidden.delete(memberId)
    } else {
      newHidden.add(memberId)
    }
    return { hiddenMembers: newHidden }
  }),

  clearMessages: () => set({ messages: [] }),

  cleanup: () => {
    const { _channels, _windChannel } = get()
    if (_channels) {
      _channels.forEach(ch => {
        try { supabase.removeChannel(ch) } catch { /* ignore */ }
      })
    }
    if (_windChannel) {
      try { supabase.removeChannel(_windChannel) } catch { /* ignore */ }
    }
    set({ _channels: null, _windChannel: null, teamWindProfiles: [] })
    stopNetworkListeners()
  }
}))

// ============================================
// Realtime Subscriptions
// ============================================

function subscribeToTeam(teamId: string, myMemberId: string) {
  const store = useTeamStore

  // 1. Neue Positionen empfangen
  const posChannel = supabase
    .channel(`team-pos-${teamId}`)
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
        // Eigene Positionen ignorieren
        if (pos.member_id === myMemberId) return

        store.setState(state => ({
          members: state.members.map(m => {
            if (m.id !== pos.member_id) return m

            const newTrackPoint: [number, number] = [pos.latitude, pos.longitude]
            const track = [...m.track, newTrackPoint]
            // Track auf MAX_TRACK_POINTS begrenzen
            if (track.length > MAX_TRACK_POINTS) {
              track.splice(0, track.length - MAX_TRACK_POINTS)
            }

            // Volle Trackdaten speichern
            const newFullPoint: TrackPoint = {
              latitude: pos.latitude,
              longitude: pos.longitude,
              altitude: pos.altitude,
              heading: pos.heading || 0,
              speed: pos.speed || 0,
              vario: pos.vario || 0,
              recordedAt: new Date(pos.recorded_at)
            }
            const trackPoints = [...m.trackPoints, newFullPoint]
            if (trackPoints.length > MAX_TRACK_POINTS) {
              trackPoints.splice(0, trackPoints.length - MAX_TRACK_POINTS)
            }

            return {
              ...m,
              currentPosition: {
                id: pos.id,
                teamId: pos.team_id,
                memberId: pos.member_id,
                latitude: pos.latitude,
                longitude: pos.longitude,
                altitude: pos.altitude,
                heading: pos.heading || 0,
                speed: pos.speed || 0,
                vario: pos.vario || 0,
                recordedAt: new Date(pos.recorded_at),
                receivedAt: new Date(pos.received_at || Date.now()),
                isQueued: pos.is_queued || false
              },
              track,
              trackPoints,
              lastSeen: new Date(),
              isOnline: true
            }
          })
        }))
      }
    )
    .subscribe()

  // 2. Member-Änderungen (Join/Leave)
  const memberChannel = supabase
    .channel(`team-members-${teamId}`)
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
          if (m.id === myMemberId) return

          // Rolle ermitteln: immer aus app_users nachladen (team_members.role kann Default 'pilot' sein)
          let memberRole: 'pilot' | 'crew' = m.role || 'pilot'
          if (m.user_id) {
            // Rolle async aus app_users nachladen (hat Priorität)
            supabase.from('app_users').select('role').eq('id', m.user_id).single().then(({ data }) => {
              if (data?.role) {
                console.log(`[Team] Realtime: Rolle für ${m.callsign} aus app_users: ${data.role}`)
                store.setState(state => ({
                  members: state.members.map(mem =>
                    mem.id === m.id ? { ...mem, role: data.role } : mem
                  )
                }))
              }
            })
          }

          store.setState(state => {
            // Duplikate verhindern: existierende Einträge mit gleicher ID oder gleichem Callsign entfernen
            const filtered = state.members.filter(mem =>
              mem.id !== m.id && mem.callsign !== m.callsign
            )
            return {
              members: [...filtered, {
                id: m.id,
                teamId: m.team_id,
                callsign: m.callsign,
                color: m.color,
                role: memberRole,
                joinedAt: new Date(m.joined_at),
                lastSeen: new Date(),
                isOnline: true,
                currentPosition: null,
                track: [],
                trackPoints: []
              }]
            }
          })
        }
        if (payload.eventType === 'DELETE') {
          const old = payload.old as any
          if (old.id === myMemberId) return
          store.setState(state => ({
            members: state.members.filter(m => m.id !== old.id),
            // Windprofile für entfernte Member aufräumen
            teamWindProfiles: state.teamWindProfiles.filter(p => p.memberId !== old.id)
          }))
        }
      }
    )
    .subscribe()

  // 3. Presence für Online/Offline Status
  const presenceChannel = supabase
    .channel(`team-presence-${teamId}`)
    .on('presence', { event: 'sync' }, () => {
      const presenceState = presenceChannel.presenceState()
      const onlineIds = new Set<string>()
      Object.values(presenceState).forEach((users: any) => {
        users.forEach((u: any) => onlineIds.add(u.member_id))
      })

      store.setState(state => ({
        members: state.members.map(m => ({
          ...m,
          isOnline: onlineIds.has(m.id)
        }))
      }))
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({
          member_id: myMemberId,
          online_at: new Date().toISOString()
        })
      }
    })

  // 4. Team-Nachrichten empfangen (ohne filter - wird im Callback gefiltert)
  const msgChannel = supabase
    .channel(`team-msg-${teamId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'team_messages'
      },
      (payload) => {
        const msg = payload.new as any
        // Nur Nachrichten fuer dieses Team
        if (msg.team_id !== teamId) return
        // Eigene Nachrichten ignorieren
        if (msg.member_id === myMemberId) return
        // Private Nachrichten nur anzeigen wenn wir der Empfänger sind
        if (msg.target_member_id && msg.target_member_id !== myMemberId) return

        // Callsign und Farbe aus Members suchen
        const members = store.getState().members
        const sender = members.find(m => m.id === msg.member_id)
        const target = msg.target_member_id ? members.find(m => m.id === msg.target_member_id) : null

        const teamMsg: TeamMessage = {
          id: msg.id,
          memberId: msg.member_id,
          callsign: sender?.callsign || '???',
          color: sender?.color || '#ffffff',
          message: msg.message,
          createdAt: new Date(msg.created_at),
          targetMemberId: msg.target_member_id || null,
          targetCallsign: target?.callsign || null
        }

        store.setState(state => ({
          messages: [...state.messages, teamMsg]
        }))
      }
    )
    .subscribe()

  // 5. Windprofil-Broadcast Channel
  const windChannel = supabase
    .channel(`team-wind-${teamId}`)
    .on('broadcast', { event: 'wind_profile' }, (payload) => {
      const data = payload.payload as any
      // Eigene Profile ignorieren
      if (data.memberId === myMemberId) return

      const windProfile: TeamWindProfile = {
        memberId: data.memberId,
        callsign: data.callsign,
        color: data.color,
        windLayers: data.windLayers.map((w: any) => ({
          altitude: w.altitude,
          direction: w.direction,
          speed: w.speed,
          timestamp: new Date(w.timestamp),
          source: w.source as WindSource,
          isStable: w.isStable,
          stableSince: w.stableSince ? new Date(w.stableSince) : undefined,
          vario: w.vario
        })),
        sharedAt: new Date(data.sharedAt)
      }

      // Profil aktualisieren oder hinzufügen (dedupliziere per memberId UND callsign)
      store.setState(state => {
        // Entferne alle bestehenden Profile mit gleicher memberId oder gleichem callsign
        const filtered = state.teamWindProfiles.filter(p =>
          p.memberId !== data.memberId && p.callsign !== data.callsign
        )
        return { teamWindProfiles: [...filtered, windProfile] }
      })
    })
    .subscribe()

  // Channels speichern für Cleanup
  store.setState({
    _channels: [posChannel, memberChannel, presenceChannel, msgChannel],
    _windChannel: windChannel
  })
}

// ============================================
// Netzwerk-Listener
// ============================================

let networkHandlers: { online: () => void; offline: () => void } | null = null

function startNetworkListeners() {
  if (networkHandlers) return

  networkHandlers = {
    online: () => {
      const store = useTeamStore.getState()
      if (store.session) {
        store.setConnectionStatus(TeamConnectionStatus.Connected)
        if (store.queue.length > 0) {
          store.flushQueue()
        }
      }
    },
    offline: () => {
      const store = useTeamStore.getState()
      if (store.session) {
        store.setConnectionStatus(TeamConnectionStatus.Offline)
      }
    }
  }

  window.addEventListener('online', networkHandlers.online)
  window.addEventListener('offline', networkHandlers.offline)
}

function stopNetworkListeners() {
  if (networkHandlers) {
    window.removeEventListener('online', networkHandlers.online)
    window.removeEventListener('offline', networkHandlers.offline)
    networkHandlers = null
  }
}
