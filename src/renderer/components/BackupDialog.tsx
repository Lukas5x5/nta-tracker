import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useFlightStore } from '../stores/flightStore'
import { supabase } from '../lib/supabase'

export function BackupDialog() {
  const { showBackupDialog, backupDialogChampionship, closeBackupDialog, getFlightSnapshot } = useFlightStore()
  const [saving, setSaving] = useState(false)

  if (!showBackupDialog || !backupDialogChampionship) return null

  // Lokales Speichern im App-Backup-Ordner (automatisch, kein Dialog)
  const saveLocally = async (name: string, snapshot: any): Promise<boolean> => {
    try {
      if (!window.ntaAPI?.files?.saveBackup) return false
      const safeName = name.replace(/[<>:"/\\|?*]/g, '_')
      const result = await window.ntaAPI.files.saveBackup({
        fileName: `${safeName}.json`,
        content: JSON.stringify(snapshot, null, 2)
      })
      if (result.success) {
        console.log('[BackupDialog] Lokal gespeichert:', result.path)
        return true
      }
      return false
    } catch { return false }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const snapshot = getFlightSnapshot()
      const now = new Date()
      const backupName = `Backup ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`

      // Online speichern
      const { error } = await supabase.from('championship_flights')
        .insert({ championship_id: backupDialogChampionship.id, name: backupName, flight_data: snapshot })

      if (error) {
        console.warn('[BackupDialog] Supabase-Fehler:', error)
      } else {
        console.log('[BackupDialog] Online gespeichert:', backupName)
      }

      // Lokal speichern (immer zusätzlich)
      await saveLocally(backupName, snapshot)
    } catch (err: any) {
      console.warn('[BackupDialog] Fehler:', err)
      const snapshot = getFlightSnapshot()
      const now = new Date()
      const backupName = `Backup ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      await saveLocally(backupName, snapshot)
    }
    setSaving(false)
    closeBackupDialog()
  }

  const handleSkip = () => {
    closeBackupDialog()
  }

  return createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50000
    }}>
      <div style={{
        background: '#1e293b',
        borderRadius: '12px',
        padding: '24px',
        minWidth: '320px',
        maxWidth: '400px',
        boxShadow: '0 25px 80px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.15)',
        textAlign: 'center'
      }}>
        <div style={{
          width: '60px', height: '60px', borderRadius: '50%',
          background: 'rgba(34, 197, 94, 0.2)', margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </div>

        <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '8px' }}>
          Tasks importiert!
        </div>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '20px' }}>
          Backup speichern für<br/>
          <strong style={{ color: '#22c55e' }}>{backupDialogChampionship.name}</strong>?
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            onClick={handleSkip}
            disabled={saving}
            style={{
              padding: '12px 20px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none', borderRadius: '8px',
              color: 'rgba(255,255,255,0.7)', fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Nein
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              border: 'none', borderRadius: '8px',
              color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer',
              opacity: saving ? 0.6 : 1
            }}
          >
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
