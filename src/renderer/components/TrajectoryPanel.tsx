import React, { useState, useRef, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { usePanelDrag } from '../hooks/usePanelDrag'
import {
  parseTrajectoryFile, trajectoryFormatName, TRAJECTORY_COLORS,
  TrajectoryImportResult
} from '../utils/trajectoryImport'

interface TrajectoryPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function TrajectoryPanel({ isOpen, onClose }: TrajectoryPanelProps) {
  const {
    importedTrajectories, addTrajectories, removeTrajectory,
    toggleTrajectoryVisibility, clearAllTrajectories, settings
  } = useFlightStore()

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<TrajectoryImportResult | null>(null)
  const [importFilename, setImportFilename] = useState('')

  // Dragging state
  const [position, setPosition] = useState({ x: window.innerWidth - 340, y: 120 })
  const panelRef = useRef<HTMLDivElement>(null)

  // Position-Change Handler für Drag
  const handlePositionChange = useCallback((pos: { x: number; y: number }) => {
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 320, pos.x)),
      y: Math.max(0, Math.min(window.innerHeight - 200, pos.y))
    })
  }, [])

  // Panel Drag Hook (Mouse + Touch)
  const { isDragging, handleMouseDown, handleTouchStart } = usePanelDrag({
    position,
    onPositionChange: handlePositionChange
  })

  // File selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportFilename(file.name)
    file.text().then(content => {
      const result = parseTrajectoryFile(content, file.name)
      setImportResult(result)
    })

    e.target.value = ''
  }

  // Import confirmed
  const handleImport = () => {
    if (!importResult || importResult.trajectories.length === 0) return

    // Re-assign colors starting from current count to avoid duplicates
    const startIndex = importedTrajectories.length
    const colored = importResult.trajectories.map((t, i) => ({
      ...t,
      color: TRAJECTORY_COLORS[(startIndex + i) % TRAJECTORY_COLORS.length]
    }))

    addTrajectories(colored)
    setImportResult(null)
    setImportFilename('')
  }

  // Clear pending import
  const handleClearImport = () => {
    setImportResult(null)
    setImportFilename('')
  }

  if (!isOpen) return null

  const scale = settings.windPanelScale ?? 1

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '320px',
        maxHeight: 'calc(100vh - 100px)',
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '12px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'transparent'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ fontWeight: 600, fontSize: '15px', color: 'white' }}>Trajektorien</span>
          {importedTrajectories.length > 0 && (
            <span style={{
              background: '#a855f7',
              color: 'white',
              padding: '3px 8px',
              borderRadius: '10px',
              fontSize: '11px',
              fontWeight: 600
            }}>
              {importedTrajectories.length}
            </span>
          )}
        </div>
        <button
          className="no-drag"
          onClick={onClose}
          style={{
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'white',
            cursor: 'pointer',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx,.kml"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Import Section */}
      <div className="no-drag" style={{
        padding: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: 'transparent'
      }}>
        {!importResult ? (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '13px',
                background: 'rgba(0,0,0,0.2)',
                color: 'white',
                border: '2px dashed rgba(255,255,255,0.1)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Datei importieren (GPX/KML)...
            </button>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '6px' }}>
              .gpx, .kml (Windy.com Trajektorien)
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* File info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '6px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'white' }}>
                  {importFilename}
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                  {trajectoryFormatName(importResult.format)} - {importResult.trajectories.length} Trajektorien
                </div>
              </div>
              <button
                onClick={handleClearImport}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: '14px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Errors */}
            {importResult.errors.length > 0 && (
              <div style={{
                padding: '8px 10px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#ef4444'
              }}>
                {importResult.errors.map((err, i) => <div key={i}>{err}</div>)}
              </div>
            )}

            {/* Warnings */}
            {importResult.warnings.length > 0 && (
              <div style={{
                padding: '8px 10px',
                background: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#eab308'
              }}>
                {importResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}

            {/* Import button */}
            {importResult.trajectories.length > 0 && (
              <button
                onClick={handleImport}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '13px',
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Importieren ({importResult.trajectories.length} Trajektorien)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Trajectory List */}
      <div className="no-drag" style={{
        flex: 1,
        overflow: 'auto',
        padding: '12px'
      }}>
        {importedTrajectories.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '30px 20px',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '13px'
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ margin: '0 auto 12px', opacity: 0.3 }}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <div>Keine Trajektorien importiert</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[...importedTrajectories].sort((a, b) => a.name.localeCompare(b.name)).map((traj) => (
              <div
                key={traj.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  background: 'transparent',
                  borderRadius: '6px',
                  borderLeft: `3px solid ${traj.color}`,
                  opacity: traj.visible ? 1 : 0.4,
                  transition: 'opacity 0.2s'
                }}
              >
                {/* Color dot */}
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  background: traj.color,
                  flexShrink: 0
                }} />

                {/* Name + info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'white',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {traj.altitudeLevel
                      ? <>{Math.round(traj.altitudeLevel * 3.28084)}ft <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.5)' }}>({traj.altitudeLevel}m)</span></>
                      : traj.name
                    }
                  </div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
                    {traj.name} · {traj.points.length} Pkt · {traj.sourceFormat.toUpperCase()}
                  </div>
                </div>

                {/* Visibility toggle */}
                <button
                  onClick={() => toggleTrajectoryVisibility(traj.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: traj.visible ? 'white' : 'rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title={traj.visible ? 'Ausblenden' : 'Einblenden'}
                >
                  {traj.visible ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  )}
                </button>

                {/* Delete */}
                <button
                  onClick={() => removeTrajectory(traj.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    opacity: 0.7
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {importedTrajectories.length > 0 && (
        <div className="no-drag" style={{
          padding: '12px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          background: 'transparent',
          display: 'flex',
          gap: '8px'
        }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '12px',
              background: 'rgba(0,0,0,0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            + Datei
          </button>
          <button
            onClick={() => {
              if (confirm('Alle Trajektorien loeschen?')) {
                clearAllTrajectories()
              }
            }}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Alle loeschen
          </button>
        </div>
      )}
    </div>
  )
}
