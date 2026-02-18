import React, { useState } from 'react'
import { ScoringArea, GPSPosition } from '../../shared/types'

interface ScoringAreaPanelProps {
  taskId: string
  scoringArea: ScoringArea | undefined
  onUpdate: (area: ScoringArea | undefined) => void
  clickedPosition: { lat: number; lon: number } | null
  onClearClick: () => void
}

export function ScoringAreaPanel({ taskId, scoringArea, onUpdate, clickedPosition, onClearClick }: ScoringAreaPanelProps) {
  const [mode, setMode] = useState<'none' | 'circle' | 'polygon' | 'sector'>('none')
  const [tempPoints, setTempPoints] = useState<GPSPosition[]>([])
  const [radius, setRadius] = useState<string>('500')
  const [startAngle, setStartAngle] = useState<string>('0')
  const [endAngle, setEndAngle] = useState<string>('90')
  const [color, setColor] = useState<string>('#3b82f6')
  const [fillColor, setFillColor] = useState<string>('#3b82f6')

  // Klick-Position verarbeiten
  React.useEffect(() => {
    if (clickedPosition && mode !== 'none') {
      const position: GPSPosition = {
        latitude: clickedPosition.lat,
        longitude: clickedPosition.lon,
        altitude: 0,
        timestamp: new Date()
      }

      if (mode === 'circle' || mode === 'sector') {
        // Für Kreis und Sektor: Nur Zentrum setzen
        const area: ScoringArea = {
          id: taskId + '_scoring',
          type: mode,
          center: position,
          radius: parseInt(radius),
          color,
          fillColor,
          visible: true
        }

        if (mode === 'sector') {
          area.startAngle = parseInt(startAngle)
          area.endAngle = parseInt(endAngle)
        }

        onUpdate(area)
        setMode('none')
        onClearClick()
      } else if (mode === 'polygon') {
        // Für Polygon: Punkte sammeln
        setTempPoints([...tempPoints, position])
        onClearClick()
      }
    }
  }, [clickedPosition, mode])

  // Polygon abschließen
  const finishPolygon = () => {
    if (tempPoints.length >= 3) {
      const area: ScoringArea = {
        id: taskId + '_scoring',
        type: 'polygon',
        points: tempPoints,
        color,
        fillColor,
        visible: true
      }
      onUpdate(area)
      setTempPoints([])
      setMode('none')
    }
  }

  // Polygon abbrechen
  const cancelPolygon = () => {
    setTempPoints([])
    setMode('none')
  }

  return (
    <div style={{
      marginTop: '20px',
      padding: '16px',
      background: 'var(--bg-secondary)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)'
    }}>
      <div style={{
        fontSize: '14px',
        fontWeight: 600,
        marginBottom: '12px',
        color: 'var(--text-primary)'
      }}>
        Scoring Area
      </div>

      {/* Typ Auswahl */}
      {!scoringArea && mode === 'none' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setMode('circle')}
            style={{ fontSize: '12px', padding: '8px' }}
          >
            ⭕ Kreis
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setMode('polygon')}
            style={{ fontSize: '12px', padding: '8px' }}
          >
            ▢ Polygon
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setMode('sector')}
            style={{ fontSize: '12px', padding: '8px' }}
          >
            ◐ Sektor
          </button>
        </div>
      )}

      {/* Kreis Modus */}
      {mode === 'circle' && (
        <div style={{
          padding: '12px',
          background: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '6px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Klicke auf die Karte um das Zentrum zu setzen
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Radius (m)
            </label>
            <input
              type="number"
              value={radius}
              onChange={e => setRadius(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '12px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Linienfarbe
              </label>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Füllfarbe
              </label>
              <input
                type="color"
                value={fillColor}
                onChange={e => setFillColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer' }}
              />
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => setMode('none')}
            style={{ width: '100%', fontSize: '12px', padding: '6px' }}
          >
            Abbrechen
          </button>
        </div>
      )}

      {/* Polygon Modus */}
      {mode === 'polygon' && (
        <div style={{
          padding: '12px',
          background: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '6px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Klicke auf die Karte um Punkte hinzuzufügen ({tempPoints.length} Punkte)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Linienfarbe
              </label>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Füllfarbe
              </label>
              <input
                type="color"
                value={fillColor}
                onChange={e => setFillColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer' }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              className="btn btn-primary"
              onClick={finishPolygon}
              disabled={tempPoints.length < 3}
              style={{ fontSize: '12px', padding: '6px' }}
            >
              Fertig ({tempPoints.length})
            </button>
            <button
              className="btn btn-secondary"
              onClick={cancelPolygon}
              style={{ fontSize: '12px', padding: '6px' }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Sektor Modus */}
      {mode === 'sector' && (
        <div style={{
          padding: '12px',
          background: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '6px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Klicke auf die Karte um das Zentrum zu setzen
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Radius (m)
            </label>
            <input
              type="number"
              value={radius}
              onChange={e => setRadius(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '12px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Start-Winkel (°)
              </label>
              <input
                type="number"
                value={startAngle}
                onChange={e => setStartAngle(e.target.value)}
                min="0"
                max="360"
                style={{
                  width: '100%',
                  padding: '6px',
                  fontSize: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                End-Winkel (°)
              </label>
              <input
                type="number"
                value={endAngle}
                onChange={e => setEndAngle(e.target.value)}
                min="0"
                max="360"
                style={{
                  width: '100%',
                  padding: '6px',
                  fontSize: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Linienfarbe
              </label>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Füllfarbe
              </label>
              <input
                type="color"
                value={fillColor}
                onChange={e => setFillColor(e.target.value)}
                style={{ width: '100%', height: '32px', cursor: 'pointer' }}
              />
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => setMode('none')}
            style={{ width: '100%', fontSize: '12px', padding: '6px' }}
          >
            Abbrechen
          </button>
        </div>
      )}

      {/* Bestehende Scoring Area */}
      {scoringArea && (
        <div style={{
          padding: '12px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {scoringArea.type === 'circle' && '⭕ Kreis'}
              {scoringArea.type === 'polygon' && '▢ Polygon'}
              {scoringArea.type === 'sector' && '◐ Sektor'}
            </div>
            <button
              onClick={() => onUpdate(undefined)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-danger)',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: '14px'
              }}
            >
              ✕
            </button>
          </div>

          {scoringArea.type === 'circle' && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Radius: {scoringArea.radius}m
            </div>
          )}

          {scoringArea.type === 'polygon' && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Punkte: {scoringArea.points?.length || 0}
            </div>
          )}

          {scoringArea.type === 'sector' && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Radius: {scoringArea.radius}m<br />
              Winkel: {scoringArea.startAngle}° - {scoringArea.endAngle}°
            </div>
          )}
        </div>
      )}
    </div>
  )
}
