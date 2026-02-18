import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTeamStore } from '../stores/teamStore'

interface GroundWindReport {
  id: string
  task_id: string
  task_name: string
  wind_direction: number | null
  wind_speed: number | null
  notes: string | null
  created_at: string
  member: {
    callsign: string
    color: string
  }
}

// Helper: Report mit Member-Infos nachladen
async function fetchReportWithMember(reportId: string): Promise<GroundWindReport | null> {
  const { data } = await supabase
    .from('ground_wind_reports')
    .select(`
      id,
      task_id,
      task_name,
      wind_direction,
      wind_speed,
      notes,
      created_at,
      member:team_members(callsign, color)
    `)
    .eq('id', reportId)
    .single()

  if (data) {
    const memberData = Array.isArray(data.member) ? data.member[0] : data.member
    return {
      id: data.id,
      task_id: data.task_id,
      task_name: data.task_name,
      wind_direction: data.wind_direction,
      wind_speed: data.wind_speed,
      notes: data.notes,
      created_at: data.created_at,
      member: memberData || { callsign: 'Unknown', color: '#6b7280' }
    }
  }
  return null
}

interface GroundWindReportsProps {
  scale?: number
  onClose: () => void
}

export function GroundWindReports({ scale = 1, onClose }: GroundWindReportsProps) {
  const { session } = useTeamStore()
  const [reports, setReports] = useState<GroundWindReport[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const channelRef = useRef<any>(null)

  // Load reports on mount AND when refreshKey changes
  useEffect(() => {
    if (!session) return

    const loadReports = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('ground_wind_reports')
        .select(`
          id,
          task_id,
          task_name,
          wind_direction,
          wind_speed,
          notes,
          created_at,
          member:team_members(callsign, color)
        `)
        .eq('team_id', session.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) {
        console.error('[GroundWind] Load error:', error)
      } else {
        setReports((data || []).map((r: any) => ({
          ...r,
          member: Array.isArray(r.member) ? r.member[0] || { callsign: 'Unknown', color: '#6b7280' } : r.member || { callsign: 'Unknown', color: '#6b7280' }
        })))
      }
      setLoading(false)
    }

    loadReports()
  }, [session?.id, refreshKey])

  // Realtime subscription - stabile Subscription die nur von session.id abhängt
  useEffect(() => {
    if (!session) return

    // Alten Channel aufräumen falls vorhanden
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const teamId = session.id

    const channel = supabase
      .channel(`ground-wind-live-${teamId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ground_wind_reports'
        },
        (payload) => {
          const record = payload.new as any
          if (record?.team_id !== teamId) return

          console.log('[GroundWind] Realtime event:', payload.eventType, 'task:', record.task_name)

          // Sofort aus dem Payload ein temporäres Report-Objekt bauen (ohne async fetch)
          // Dann async die vollständigen Member-Infos nachladen
          if (payload.eventType === 'INSERT') {
            // Sofort anzeigen mit member_id als Platzhalter
            const tempReport: GroundWindReport = {
              id: record.id,
              task_id: record.task_id,
              task_name: record.task_name,
              wind_direction: record.wind_direction,
              wind_speed: record.wind_speed,
              notes: record.notes,
              created_at: record.created_at,
              member: { callsign: '...', color: '#6b7280' }
            }
            setReports(prev => [tempReport, ...prev.slice(0, 19)])

            // Member-Infos async nachladen und ersetzen
            fetchReportWithMember(record.id).then(fullReport => {
              if (fullReport) {
                setReports(prev => prev.map(r => r.id === fullReport.id ? fullReport : r))
              }
            })
          } else if (payload.eventType === 'UPDATE') {
            // Sofort aktualisieren mit vorhandenen Daten
            setReports(prev => {
              const filtered = prev.filter(r => r.id !== record.id)
              const tempReport: GroundWindReport = {
                id: record.id,
                task_id: record.task_id,
                task_name: record.task_name,
                wind_direction: record.wind_direction,
                wind_speed: record.wind_speed,
                notes: record.notes,
                created_at: record.created_at,
                member: prev.find(r => r.id === record.id)?.member || { callsign: '...', color: '#6b7280' }
              }
              return [tempReport, ...filtered.slice(0, 19)]
            })

            // Vollständige Daten nachladen
            fetchReportWithMember(record.id).then(fullReport => {
              if (fullReport) {
                setReports(prev => prev.map(r => r.id === fullReport.id ? fullReport : r))
              }
            })
          }
        }
      )
      .subscribe((status) => {
        console.log('[GroundWind] Realtime subscription status:', status)
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [session?.id])

  // Format wind direction to compass
  const formatDirection = (deg: number): string => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    const index = Math.round(deg / 22.5) % 16
    return directions[index]
  }

  // Format time ago
  const formatTimeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'gerade eben'
    if (minutes < 60) return `vor ${minutes} min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `vor ${hours} h`
    return `vor ${Math.floor(hours / 24)} d`
  }

  return (
    <div style={{
      background: 'rgba(0,0,0,0.3)',
      borderRadius: `${8 * scale}px`,
      border: '1px solid rgba(255,255,255,0.1)',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${8 * scale}px ${10 * scale}px`,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(59, 130, 246, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: `${6 * scale}px`,
          fontSize: `${11 * scale}px`,
          fontWeight: 600,
          color: '#3b82f6'
        }}>
          <svg width={14 * scale} height={14 * scale} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
          </svg>
          Bodenwind-Meldungen
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: `${4 * scale}px` }}>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            title="Aktualisieren"
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: `${12 * scale}px`,
              padding: `${2 * scale}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <svg width={12 * scale} height={12 * scale} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: `${14 * scale}px`,
              padding: `${2 * scale}px`
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        maxHeight: `${200 * scale}px`,
        overflowY: 'auto',
        padding: `${6 * scale}px`
      }}>
        {loading ? (
          <div style={{
            padding: `${16 * scale}px`,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: `${10 * scale}px`
          }}>
            Lade...
          </div>
        ) : reports.length === 0 ? (
          <div style={{
            padding: `${16 * scale}px`,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: `${10 * scale}px`
          }}>
            Keine Bodenwind-Meldungen
          </div>
        ) : (
          reports.map(report => (
            <div
              key={report.id}
              style={{
                padding: `${8 * scale}px`,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: `${6 * scale}px`,
                marginBottom: `${6 * scale}px`,
                borderLeft: `3px solid ${report.member.color}`
              }}
            >
              {/* Task Name & Time */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: `${4 * scale}px`
              }}>
                <span style={{
                  fontSize: `${11 * scale}px`,
                  fontWeight: 600,
                  color: '#fff'
                }}>
                  {report.task_name}
                </span>
                <span style={{
                  fontSize: `${9 * scale}px`,
                  color: 'rgba(255,255,255,0.4)'
                }}>
                  {formatTimeAgo(report.created_at)}
                </span>
              </div>

              {/* Wind Info */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: `${12 * scale}px`,
                marginBottom: `${4 * scale}px`
              }}>
                {report.wind_direction !== null && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: `${4 * scale}px`
                  }}>
                    <svg
                      width={16 * scale}
                      height={16 * scale}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      style={{
                        transform: `rotate(${report.wind_direction + 180}deg)`
                      }}
                    >
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                    <span style={{
                      fontSize: `${13 * scale}px`,
                      fontWeight: 700,
                      color: '#fff',
                      fontFamily: 'monospace'
                    }}>
                      {report.wind_direction}°
                    </span>
                    <span style={{
                      fontSize: `${10 * scale}px`,
                      color: 'rgba(255,255,255,0.5)'
                    }}>
                      ({formatDirection(report.wind_direction)})
                    </span>
                  </div>
                )}
                {report.wind_speed !== null && (
                  <div style={{
                    fontSize: `${13 * scale}px`,
                    fontWeight: 700,
                    color: '#fff',
                    fontFamily: 'monospace'
                  }}>
                    {Math.round(report.wind_speed * 3.6)} km/h
                  </div>
                )}
                {report.wind_direction === null && report.wind_speed === null && (
                  <span style={{
                    fontSize: `${11 * scale}px`,
                    color: 'rgba(255,255,255,0.4)',
                    fontStyle: 'italic'
                  }}>
                    Nur Notiz
                  </span>
                )}
              </div>

              {/* Reporter & Notes */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: `${9 * scale}px`,
                color: 'rgba(255,255,255,0.5)'
              }}>
                <span style={{ color: report.member.color }}>
                  {report.member.callsign}
                </span>
                {report.notes && (
                  <span style={{ fontStyle: 'italic' }}>
                    {report.notes}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
