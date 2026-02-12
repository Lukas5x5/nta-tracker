import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTrackerStore, type PilotTask } from '../stores/trackerStore'
import { useAuthStore } from '../stores/authStore'

interface GroundWindDialogProps {
  task: PilotTask
  onClose: () => void
}

export function GroundWindDialog({ task, onClose }: GroundWindDialogProps) {
  const { team } = useTrackerStore()
  const { user } = useAuthStore()
  const [direction, setDirection] = useState('')
  const [speed, setSpeed] = useState('')
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [crewMemberId, setCrewMemberId] = useState<string | null>(null)

  // Crew-Member erstellen oder finden
  useEffect(() => {
    if (!team || !user) return

    const findOrCreateCrewMember = async () => {
      // Prüfen ob User schon als Crew-Member im Team ist
      const { data: existing } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', team.id)
        .eq('user_id', user.id)
        .single()

      if (existing) {
        setCrewMemberId(existing.id)
        return
      }

      // Neuen Crew-Member erstellen
      const { data: newMember, error: createError } = await supabase
        .from('team_members')
        .insert({
          team_id: team.id,
          user_id: user.id,
          callsign: `Crew-${user.display_name || user.username}`,
          color: '#6b7280'  // Grau für Crew
        })
        .select('id')
        .single()

      if (createError) {
        console.error('[GroundWind] Failed to create crew member:', createError)
        return
      }

      if (newMember) {
        setCrewMemberId(newMember.id)
      }
    }

    findOrCreateCrewMember()
  }, [team, user])

  const handleSave = async () => {
    const dir = direction ? parseInt(direction) : null
    const spd = speed ? parseFloat(speed) : null

    // Validierung nur wenn Werte eingegeben wurden
    if (dir !== null && (isNaN(dir) || dir < 0 || dir > 359)) {
      setError('Richtung muss zwischen 0 und 359 sein')
      return
    }
    if (spd !== null && (isNaN(spd) || spd < 0 || spd > 180)) {
      setError('Geschwindigkeit muss zwischen 0 und 180 km/h sein')
      return
    }
    // Mindestens ein Wert muss eingegeben werden
    if (dir === null && spd === null && !notes.trim()) {
      setError('Bitte mindestens ein Feld ausfüllen')
      return
    }
    if (!team) {
      setError('Kein Team verbunden')
      return
    }
    if (!crewMemberId) {
      setError('Crew-Member konnte nicht erstellt werden')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      // Goal Position für die Messung
      const goalPos = task.goals[0]?.position

      // km/h in m/s umrechnen für die Datenbank
      const spdMs = spd !== null ? spd / 3.6 : null

      // Prüfen ob bereits ein Report für diesen Task existiert
      const { data: existing } = await supabase
        .from('ground_wind_reports')
        .select('id')
        .eq('team_id', team.id)
        .eq('task_id', task.id)
        .single()

      if (existing) {
        // Update existierenden Report
        const { error: updateError } = await supabase
          .from('ground_wind_reports')
          .update({
            member_id: crewMemberId,
            wind_direction: dir,
            wind_speed: spdMs,
            latitude: goalPos?.latitude || null,
            longitude: goalPos?.longitude || null,
            notes: notes.trim() || null,
            created_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (updateError) {
          console.error('[GroundWind] Update error:', updateError)
          setError('Fehler beim Aktualisieren: ' + updateError.message)
          setIsSaving(false)
          return
        }
        console.log('[GroundWind] Wind report updated for task:', task.name)
      } else {
        // Neuen Report erstellen
        const { error: insertError } = await supabase
          .from('ground_wind_reports')
          .insert({
            team_id: team.id,
            member_id: crewMemberId,
            task_id: task.id,
            task_name: task.name,
            wind_direction: dir,
            wind_speed: spdMs,
            latitude: goalPos?.latitude || null,
            longitude: goalPos?.longitude || null,
            notes: notes.trim() || null
          })

        if (insertError) {
          console.error('[GroundWind] Insert error:', insertError)
          setError('Fehler beim Speichern: ' + insertError.message)
          setIsSaving(false)
          return
        }
        console.log('[GroundWind] Wind report created for task:', task.name)
      }

      onClose()
    } catch (err) {
      console.error('[GroundWind] Error:', err)
      setError('Verbindungsfehler')
      setIsSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: 20
    }}>
      <div style={{
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: 12,
        width: '100%',
        maxWidth: 340,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
              Bodenwind melden
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              {task.name}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: 'rgba(255,255,255,0.7)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Wind Direction */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: 6
            }}>
              Windrichtung (Grad)
            </label>
            <input
              type="number"
              min="0"
              max="359"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              placeholder="z.B. 270"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: '#fff',
                fontSize: 14,
                fontFamily: 'monospace'
              }}
            />
          </div>

          {/* Wind Speed */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: 6
            }}>
              Windgeschwindigkeit (km/h)
            </label>
            <input
              type="number"
              min="0"
              max="180"
              step="1"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="z.B. 12"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: '#fff',
                fontSize: 14,
                fontFamily: 'monospace'
              }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: 6
            }}>
              Notizen (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z.B. böig, stabil..."
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: '#fff',
                fontSize: 14
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#ef4444',
              fontSize: 12
            }}>
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: isSaving ? 'rgba(59, 130, 246, 0.3)' : '#3b82f6',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: isSaving ? 'not-allowed' : 'pointer'
              }}
            >
              {isSaving ? 'Sende...' : 'Senden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
