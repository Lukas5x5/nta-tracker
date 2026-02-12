import React from 'react'
import { useTrackerStore, type PilotPosition } from '../stores/trackerStore'

interface PilotListProps {
  onClose: () => void
}

export function PilotList({ onClose }: PilotListProps) {
  const { pilots, selectedPilot, selectPilot } = useTrackerStore()

  // Sort: online first, then by callsign
  const sortedPilots = [...pilots].sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
    return a.callsign.localeCompare(b.callsign)
  })

  const handleSelect = (pilot: PilotPosition) => {
    selectPilot(pilot.memberId)
    onClose()
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>
          Piloten ({pilots.filter(p => p.isOnline).length}/{pilots.length})
        </h2>
        <button
          onClick={onClose}
          style={{
            width: 36,
            height: 36,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>
      </div>

      {/* Pilot Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sortedPilots.length === 0 ? (
          <div style={{
            padding: 32,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)'
          }}>
            Keine Piloten aktiv
          </div>
        ) : (
          sortedPilots.map(pilot => (
            <PilotCard
              key={pilot.memberId}
              pilot={pilot}
              isSelected={pilot.memberId === selectedPilot}
              onSelect={() => handleSelect(pilot)}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface PilotCardProps {
  pilot: PilotPosition
  isSelected: boolean
  onSelect: () => void
}

function PilotCard({ pilot, isSelected, onSelect }: PilotCardProps) {
  const altFt = Math.round(pilot.altitude * 3.28084)
  const speedKmh = Math.round(pilot.speed * 3.6)
  const varioMs = pilot.vario.toFixed(1)

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        background: isSelected
          ? 'rgba(59, 130, 246, 0.15)'
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 12,
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        opacity: pilot.isOnline ? 1 : 0.5
      }}
    >
      {/* Avatar */}
      <div style={{
        position: 'relative',
        flexShrink: 0
      }}>
        <div style={{
          width: 44,
          height: 44,
          background: pilot.color,
          borderRadius: '50%',
          border: '3px solid #fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        }}>
          <span style={{
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)'
          }}>
            {pilot.callsign.substring(0, 2)}
          </span>
        </div>
        {/* Online indicator */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 12,
          height: 12,
          background: pilot.isOnline ? '#22c55e' : '#6b7280',
          borderRadius: '50%',
          border: '2px solid #0f172a',
          boxShadow: pilot.isOnline ? '0 0 6px #22c55e' : 'none'
        }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          color: '#fff',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {pilot.callsign}
        </div>
        <div style={{
          display: 'flex',
          gap: 10,
          fontSize: 11,
          color: 'rgba(255,255,255,0.6)'
        }}>
          <span style={{ fontFamily: 'monospace' }}>{altFt} ft</span>
          <span style={{ fontFamily: 'monospace' }}>{Math.round(pilot.heading)}°</span>
          <span style={{ fontFamily: 'monospace' }}>{speedKmh} km/h</span>
          <span style={{
            fontFamily: 'monospace',
            color: pilot.vario > 0.3 ? '#22c55e' : pilot.vario < -0.3 ? '#ef4444' : 'rgba(255,255,255,0.6)'
          }}>
            {pilot.vario > 0 ? '+' : ''}{varioMs} m/s
          </span>
        </div>
      </div>

      {/* Arrow */}
      <div style={{
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 8,
        flexShrink: 0
      }}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="2"
          style={{ transform: `rotate(${pilot.heading}deg)` }}
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </div>
    </button>
  )
}
