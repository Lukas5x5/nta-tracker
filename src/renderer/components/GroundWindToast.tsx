import React from 'react'
import { useTeamStore } from '../stores/teamStore'

export function GroundWindToast() {
  const groundWindToast = useTeamStore(s => s.groundWindToast)
  const setGroundWindToast = useTeamStore(s => s.setGroundWindToast)
  const acceptGroundWind = useTeamStore(s => s.acceptGroundWind)

  if (!groundWindToast) return null

  return (
    <div style={{
      position: 'fixed',
      top: '80px',
      left: '20px',
      background: 'linear-gradient(135deg, #1e293b, #0f172a)',
      color: 'white',
      padding: '14px 18px',
      borderRadius: '12px',
      border: `2px solid ${groundWindToast.color}`,
      boxShadow: `0 4px 20px rgba(0, 0, 0, 0.5), 0 0 15px ${groundWindToast.color}40`,
      zIndex: 10002,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      animation: 'slideIn 0.3s ease-out',
      minWidth: '280px',
      maxWidth: '400px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={groundWindToast.color} strokeWidth="2">
          <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '11px', color: groundWindToast.color, marginBottom: '2px' }}>
            {groundWindToast.callsign} · Bodenwind
          </div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>
            {groundWindToast.windDirection !== null ? `${groundWindToast.windDirection}°` : '—'}
            {' / '}
            {groundWindToast.windSpeed !== null ? `${(groundWindToast.windSpeed * 3.6).toFixed(1)} km/h` : '—'}
          </div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
            Task: {groundWindToast.taskName}
            {groundWindToast.notes?.match(/\[BH:(\d)\]/) && (
              <span> · {parseInt(groundWindToast.notes.match(/\[BH:(\d)\]/)![1])}x Ballonhöhe</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setGroundWindToast(null)}
          style={{
            background: 'rgba(255, 255, 255, 0.1)', border: 'none',
            color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
            padding: '4px', borderRadius: '6px', fontSize: '16px', lineHeight: 1,
            alignSelf: 'flex-start'
          }}
        >✕</button>
      </div>
      <button
        onClick={() => acceptGroundWind()}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: '8px', border: 'none',
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
        }}
      >↓ Ins Windprofil übernehmen</button>
    </div>
  )
}
