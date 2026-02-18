import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { usePanelDrag } from '../hooks/usePanelDrag'
import { ScoringArea, GPSPosition } from '../../shared/types'

interface DrawingPanelProps {
  isOpen: boolean
  onClose: () => void
  onDrawingModeChange: (mode: 'none' | 'circle' | 'freehand' | 'line') => void
  drawingMode: 'none' | 'circle' | 'freehand' | 'line'
  gridSnapping?: boolean
  onGridSnappingChange?: (enabled: boolean) => void
  onAddStartPoint?: (lat: number, lon: number) => void
}

export function DrawingPanel({
  isOpen,
  onClose,
  onDrawingModeChange,
  drawingMode,
  gridSnapping: externalGridSnapping,
  onGridSnappingChange,
  onAddStartPoint
}: DrawingPanelProps) {
  const { settings, updateSettings, addScoringArea, scoringAreas, removeScoringArea, activeCompetitionMap } = useFlightStore()

  // UTM Bounds aus aktiver Wettkampfkarte (Priorität vor Settings)
  const mapUtmBounds = activeCompetitionMap?.utmReprojection?.utmBounds
  const mapUtmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone

  // UTM Base aus Karte oder Settings
  const hasValidMapBounds = mapUtmBounds &&
    typeof mapUtmBounds.minE === 'number' && !isNaN(mapUtmBounds.minE) &&
    typeof mapUtmBounds.minN === 'number' && !isNaN(mapUtmBounds.minN)

  const utmBaseEasting = hasValidMapBounds
    ? Math.floor(mapUtmBounds.minE / 100000) * 100000
    : (settings.utmBaseEasting || 500000)
  const utmBaseNorthing = hasValidMapBounds
    ? Math.floor(mapUtmBounds.minN / 100000) * 100000
    : (settings.utmBaseNorthing || 5300000)
  const utmZone = mapUtmZone || settings.utmZone || 33
  const panelRef = useRef<HTMLDivElement>(null)

  // Position aus Settings oder default
  const position = settings.drawingPanelPosition || { x: 20, y: 80 }

  // Position-Change Handler für Drag
  const handlePositionChange = useCallback((pos: { x: number; y: number }) => {
    updateSettings({ drawingPanelPosition: pos })
  }, [updateSettings])

  // Panel Drag Hook (Mouse + Touch)
  const { isDragging, handleMouseDown, handleTouchStart } = usePanelDrag({
    position,
    onPositionChange: handlePositionChange
  })

  // Farben für neue Shapes - use settings
  const lineColor = settings.drawingLineColor || '#3b82f6'
  const fillColor = settings.drawingFillColor || '#3b82f6'

  // Grid Snapping - use external state if provided, otherwise local
  const [localGridSnapping, setLocalGridSnapping] = useState(false)

  const gridSnapping = externalGridSnapping ?? localGridSnapping

  const setGridSnapping = (value: boolean) => {
    if (onGridSnappingChange) {
      onGridSnappingChange(value)
    } else {
      setLocalGridSnapping(value)
    }
  }

  if (!isOpen) return null

  // Panel Skalierung - echte transform scale für Breite UND Höhe
  const scale = settings.drawPanelScale ?? 1

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1001,
        width: '320px',
        maxHeight: '85vh',
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '16px',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '24px' }}>✏️</span>
          <div>
            <div style={{
              fontSize: '18px',
              fontWeight: 700,
              color: 'white'
            }}>
              Draw Scoring Areas
            </div>
            <div style={{
              fontSize: '11px',
              color: 'rgba(255,255,255,0.4)',
              marginTop: '2px'
            }}>
              {scoringAreas?.length || 0} Area{(scoringAreas?.length || 0) !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.6)',
            padding: '6px 10px',
            borderRadius: '8px',
            transition: 'all 0.15s'
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{
        maxHeight: 'calc(85vh - 80px)',
        overflow: 'auto',
        padding: '20px'
      }}>
        {/* Drawing Tools */}
        <div style={{
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            marginBottom: '12px',
            color: 'white'
          }}>
            Zeichen-Werkzeuge
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px'
          }}>
            <button
              className={`btn ${drawingMode === 'circle' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onDrawingModeChange(drawingMode === 'circle' ? 'none' : 'circle')}
              style={{
                padding: '12px',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                flex: 1
              }}
            >
              <span style={{ fontSize: '20px' }}>⭕</span>
              <span>Kreis</span>
            </button>

            <button
              className={`btn ${drawingMode === 'line' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onDrawingModeChange(drawingMode === 'line' ? 'none' : 'line')}
              style={{
                padding: '12px',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                flex: 1
              }}
            >
              <span style={{ fontSize: '20px' }}>📏</span>
              <span>Linie</span>
            </button>

            <button
              className={`btn ${drawingMode === 'freehand' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onDrawingModeChange(drawingMode === 'freehand' ? 'none' : 'freehand')}
              style={{
                padding: '12px',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                flex: 1
              }}
            >
              <span style={{ fontSize: '20px' }}>✏️</span>
              <span>Freihand</span>
            </button>
          </div>

          {drawingMode !== 'none' && (
            <div style={{
              marginTop: '12px',
              padding: '12px',
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'rgba(255,255,255,0.7)'
            }}>
              {drawingMode === 'circle' && '⭕ Klicke auf die Karte um Kreis-Zentrum zu setzen'}
              {drawingMode === 'line' && '📏 Klicke 2 Punkte für Start und Ende der Linie'}
              {drawingMode === 'freehand' && '✏️ Klicke auf die Karte um Punkte zu zeichnen'}
            </div>
          )}
        </div>

        {/* Circle Radius Input */}
        {drawingMode === 'circle' && (
          <div style={{
            marginBottom: '20px',
            padding: '16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '12px'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '12px',
              color: 'white'
            }}>
              Kreis-Einstellungen
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.5)',
                display: 'block',
                marginBottom: '6px'
              }}>
                Radius (Meter)
              </label>
              <input
                type="number"
                value={settings.circleRadius ?? 500}
                onChange={e => {
                  const val = e.target.value === '' ? 500 : parseInt(e.target.value)
                  updateSettings({ circleRadius: val })
                }}
                placeholder="500"
                min="10"
                max="10000"
                step="10"
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '13px'
                }}
              />
            </div>

            {/* Grid Snapping für Kreis */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'white',
              marginBottom: '16px'
            }}>
              <input
                type="checkbox"
                checked={settings.circleGridSnapping || false}
                onChange={e => updateSettings({ circleGridSnapping: e.target.checked })}
                style={{
                  width: '16px',
                  height: '16px',
                  cursor: 'pointer'
                }}
              />
              Grid Snapping für Mittelpunkt
            </label>

            {/* Koordinaten-Eingabe für Kreis */}
            <div style={{
              paddingTop: '12px',
              borderTop: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '12px',
                color: 'white'
              }}>
                Kreis per Koordinaten zeichnen
              </div>

              {/* Precision Info */}
              <div style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: '8px'
              }}>
                Format: {(() => {
                  const fmt = settings.coordinateFormat || 'mgrs5'
                  if (fmt === 'mgrs4') return '4/4-stellig'
                  if (fmt === 'mgrs45') return '4/5-stellig'
                  if (fmt === 'mgrs54') return '5/4-stellig'
                  if (fmt === 'mgrs6') return '6/6-stellig'
                  return '5/5-stellig'
                })()}
              </div>

              {/* East/North Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                    EAST
                  </div>
                  <input
                    type="text"
                    value={settings.circleCenterEasting ?? ''}
                    onChange={e => {
                      const val = e.target.value.replace(/[^0-9]/g, '')
                      updateSettings({ circleCenterEasting: val })
                    }}
                    placeholder={(() => {
                      const fmt = settings.coordinateFormat || 'mgrs5'
                      if (fmt === 'mgrs4' || fmt === 'mgrs45') return '1234'
                      if (fmt === 'mgrs6') return '123456'
                      return '12345'
                    })()}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '6px',
                      color: '#3b82f6',
                      fontSize: '16px',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      letterSpacing: '2px',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                    NORTH
                  </div>
                  <input
                    type="text"
                    value={settings.circleCenterNorthing ?? ''}
                    onChange={e => {
                      const val = e.target.value.replace(/[^0-9]/g, '')
                      updateSettings({ circleCenterNorthing: val })
                    }}
                    placeholder={(() => {
                      const fmt = settings.coordinateFormat || 'mgrs5'
                      if (fmt === 'mgrs4' || fmt === 'mgrs54') return '1234'
                      if (fmt === 'mgrs6') return '123456'
                      return '12345'
                    })()}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '6px',
                      color: '#3b82f6',
                      fontSize: '16px',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      letterSpacing: '2px',
                      textAlign: 'center'
                    }}
                  />
                </div>
              </div>

              {/* Draw Circle Button */}
              <button
                className="btn btn-primary"
                disabled={!settings.circleCenterEasting || !settings.circleCenterNorthing}
                onClick={async () => {
                  try {
                    const { utmToLatLon } = await import('../utils/coordinatesWGS84')

                    // padEnd(5, '0') wie in BriefingPanel
                    const eastMeters = parseInt((settings.circleCenterEasting || '').padEnd(5, '0'))
                    const northMeters = parseInt((settings.circleCenterNorthing || '').padEnd(5, '0'))

                    let fullEasting: number
                    let fullNorthing: number

                    // Intelligente Quadrat-Auswahl wie BriefingPanel
                    if (hasValidMapBounds && mapUtmBounds) {
                      // Easting: Finde das passende 100km-Quadrat
                      const minEQuadrant = Math.floor(mapUtmBounds.minE / 100000) * 100000
                      const maxEQuadrant = Math.floor(mapUtmBounds.maxE / 100000) * 100000

                      if (minEQuadrant === maxEQuadrant) {
                        fullEasting = minEQuadrant + eastMeters
                      } else {
                        // Karte überdeckt mehrere Quadrate - prüfe welches passt
                        const candidateMin = minEQuadrant + eastMeters
                        const candidateMax = maxEQuadrant + eastMeters

                        if (candidateMin >= mapUtmBounds.minE && candidateMin <= mapUtmBounds.maxE) {
                          fullEasting = candidateMin
                        } else if (candidateMax >= mapUtmBounds.minE && candidateMax <= mapUtmBounds.maxE) {
                          fullEasting = candidateMax
                        } else {
                          const mapCenterE = (mapUtmBounds.minE + mapUtmBounds.maxE) / 2
                          fullEasting = Math.abs(candidateMin - mapCenterE) < Math.abs(candidateMax - mapCenterE)
                            ? candidateMin : candidateMax
                        }
                      }

                      // Northing: Gleiches Prinzip
                      const minNQuadrant = Math.floor(mapUtmBounds.minN / 100000) * 100000
                      const maxNQuadrant = Math.floor(mapUtmBounds.maxN / 100000) * 100000

                      if (minNQuadrant === maxNQuadrant) {
                        fullNorthing = minNQuadrant + northMeters
                      } else {
                        const candidateMin = minNQuadrant + northMeters
                        const candidateMax = maxNQuadrant + northMeters

                        if (candidateMin >= mapUtmBounds.minN && candidateMin <= mapUtmBounds.maxN) {
                          fullNorthing = candidateMin
                        } else if (candidateMax >= mapUtmBounds.minN && candidateMax <= mapUtmBounds.maxN) {
                          fullNorthing = candidateMax
                        } else {
                          const mapCenterN = (mapUtmBounds.minN + mapUtmBounds.maxN) / 2
                          fullNorthing = Math.abs(candidateMin - mapCenterN) < Math.abs(candidateMax - mapCenterN)
                            ? candidateMin : candidateMax
                        }
                      }

                      console.log('[DrawingPanel] Intelligente Quadrat-Auswahl:', {
                        input: { east: settings.circleCenterEasting, north: settings.circleCenterNorthing },
                        mapUtmBounds,
                        result: { fullEasting, fullNorthing }
                      })
                    } else {
                      // Fallback: Verwende Settings als Grid Square Base
                      const gridSquareEastBase = Math.floor((settings.utmBaseEasting || 500000) / 100000) * 100000
                      const gridSquareNorthBase = Math.floor((settings.utmBaseNorthing || 5300000) / 100000) * 100000
                      fullEasting = gridSquareEastBase + eastMeters
                      fullNorthing = gridSquareNorthBase + northMeters

                      console.log('[DrawingPanel] Fallback auf Settings:', {
                        input: { east: settings.circleCenterEasting, north: settings.circleCenterNorthing },
                        gridSquareBase: { gridSquareEastBase, gridSquareNorthBase },
                        result: { fullEasting, fullNorthing }
                      })
                    }

                    console.log('=== Circle Drawing Debug ===')
                    console.log('Input East:', settings.circleCenterEasting, '→', eastMeters, '→', fullEasting)
                    console.log('Input North:', settings.circleCenterNorthing, '→', northMeters, '→', fullNorthing)
                    console.log('UTM Zone:', utmZone, 'hasValidMapBounds:', hasValidMapBounds)

                    const center = utmToLatLon({
                      zone: utmZone,
                      hemisphere: 'N',
                      easting: fullEasting,
                      northing: fullNorthing
                    })

                    console.log('Center:', center)

                    if (!center || isNaN(center.lat) || isNaN(center.lon)) {
                      console.error('Invalid coordinates calculated!')
                      alert('Fehler: Ungültige Koordinaten berechnet. Bitte überprüfe die Eingaben.')
                      return
                    }

                    const radius = settings.circleRadius ?? 500

                    // Create circle
                    addScoringArea({
                      type: 'circle',
                      center: { latitude: center.lat, longitude: center.lon, altitude: 0, timestamp: new Date() },
                      radius: radius,
                      color: settings.drawingLineColor || '#3b82f6',
                      fillColor: settings.drawingFillColor || '#3b82f6',
                      visible: true,
                      name: `Kreis E${settings.circleCenterEasting} N${settings.circleCenterNorthing}`
                    })

                    console.log('Circle created successfully!')

                    // Clear inputs and deactivate mode
                    updateSettings({
                      circleCenterEasting: '',
                      circleCenterNorthing: ''
                    })
                    onDrawingModeChange?.('none')
                  } catch (error) {
                    console.error('Error drawing circle:', error)
                    alert('Fehler beim Zeichnen des Kreises: ' + error)
                  }
                }}
                style={{
                  width: '100%'
                }}
              >
                Kreis zeichnen
              </button>

              <div style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.4)',
                marginTop: '8px',
                fontStyle: 'italic'
              }}>
                Oder klicke auf die Karte um den Mittelpunkt zu setzen
              </div>
            </div>
          </div>
        )}

        {/* Color Settings */}
        <div style={{
          marginBottom: '20px',
          padding: '16px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '12px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            marginBottom: '12px',
            color: 'white'
          }}>
            Farben
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px'
          }}>
            <div>
              <label style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.5)',
                display: 'block',
                marginBottom: '6px'
              }}>
                Linie
              </label>
              <input
                type="color"
                value={lineColor}
                onChange={e => updateSettings({ drawingLineColor: e.target.value })}
                style={{
                  width: '100%',
                  height: '40px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              />
            </div>

            <div>
              <label style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.5)',
                display: 'block',
                marginBottom: '6px'
              }}>
                Füllung
              </label>
              <input
                type="color"
                value={fillColor}
                onChange={e => updateSettings({ drawingFillColor: e.target.value })}
                style={{
                  width: '100%',
                  height: '40px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>
        </div>

        {/* Grid Snapping - nur bei Freihand-Zeichnen */}
        {drawingMode === 'freehand' && (
          <div style={{
            marginBottom: '20px',
            padding: '16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '12px'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '12px',
              color: 'white'
            }}>
              Freihand-Einstellungen
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'white'
            }}>
              <input
                type="checkbox"
                checked={gridSnapping}
                onChange={e => setGridSnapping(e.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              Grid Snapping aktivieren
            </label>
            <div style={{
              fontSize: '10px',
              color: 'rgba(255,255,255,0.4)',
              marginTop: '4px',
              marginLeft: '26px',
              fontStyle: 'italic'
            }}>
              Punkte werden am Grid ausgerichtet
            </div>
          </div>
        )}

        {/* Line Settings */}
        {drawingMode === 'line' && (
          <div style={{
            marginBottom: '20px',
            padding: '16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '12px'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '12px',
              color: 'white'
            }}>
              Linien-Einstellungen
            </div>

            {/* Grid Snapping Checkbox */}
            <div style={{
              marginBottom: '16px'
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'white'
              }}>
                <input
                  type="checkbox"
                  checked={settings.lineGridSnapping || false}
                  onChange={e => updateSettings({ lineGridSnapping: e.target.checked })}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer'
                  }}
                />
                Grid Snapping
              </label>
            </div>

            {/* Line Width Slider */}
            <div style={{
              marginBottom: '16px'
            }}>
              <div style={{
                fontSize: '13px',
                color: 'white',
                marginBottom: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>Linienstärke</span>
                <span style={{ fontWeight: 600 }}>{settings.lineWidth || 3}px</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={settings.lineWidth || 3}
                onChange={e => updateSettings({ lineWidth: parseInt(e.target.value) })}
                style={{
                  width: '100%',
                  cursor: 'pointer'
                }}
              />
            </div>

            {/* Easting Line (NS) - Vertikale Linie */}
            <div style={{
              paddingTop: '12px',
              borderTop: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '8px',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '16px' }}>↕️</span>
                Easting Line (N-S)
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                Vertikale Linie bei E-Koordinate
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={settings.lineEastingValue ?? ''}
                    onChange={e => updateSettings({ lineEastingValue: e.target.value.replace(/[^0-9]/g, '') })}
                    placeholder={(() => {
                      const fmt = settings.coordinateFormat || 'mgrs5'
                      if (fmt === 'mgrs4' || fmt === 'mgrs45') return 'z.B. 1700'
                      if (fmt === 'mgrs6') return 'z.B. 170000'
                      return 'z.B. 17000'
                    })()}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '6px',
                      color: '#3b82f6',
                      fontSize: '16px',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      letterSpacing: '2px',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!settings.lineEastingValue}
                  onClick={async () => {
                    try {
                      const { utmToLatLon, latLonToUTM } = await import('../utils/coordinatesWGS84')
                      const { useFlightStore } = await import('../stores/flightStore')

                      const state = useFlightStore.getState()
                      const gpsData = state.gpsData

                      // Aktive Wettkampfkarte direkt aus dem Store
                      const activeMap = state.activeCompetitionMap

                      // UTM Zone: Priorität 1) Map utmReprojection, 2) Map utmZone, 3) Settings
                      let localUtmZone = activeMap?.utmReprojection?.utmZone || activeMap?.utmZone || settings.utmZone

                      // Wenn Map Bounds vorhanden, berechne die UTM Zone aus dem Kartenzentrum
                      if (activeMap?.bounds && !localUtmZone) {
                        const centerLon = (activeMap.bounds.west + activeMap.bounds.east) / 2
                        localUtmZone = Math.floor((centerLon + 180) / 6) + 1
                      }
                      // Fallback auf GPS-Position für Zone-Berechnung
                      if (!localUtmZone && gpsData?.longitude) {
                        localUtmZone = Math.floor((gpsData.longitude + 180) / 6) + 1
                      }
                      localUtmZone = localUtmZone || 33

                      // Grid Square Base berechnen
                      let gridSquareEastBase = 0
                      let gridSquareNorthBase = 0
                      let mapNorthMin = 0
                      let mapNorthMax = 99999

                      // Prüfe ob utmBounds mit gültigen Werten existiert
                      const utmBounds = activeMap?.utmReprojection?.utmBounds
                      const hasValidUtmBounds = utmBounds &&
                        typeof utmBounds.minE === 'number' && !isNaN(utmBounds.minE) &&
                        typeof utmBounds.minN === 'number' && !isNaN(utmBounds.minN)

                      console.log('=== Easting UTM Bounds Check ===')
                      console.log('utmBounds:', utmBounds)
                      console.log('hasValidUtmBounds:', hasValidUtmBounds)

                      if (hasValidUtmBounds) {
                        // Verwende UTM Bounds aus der reprojizierten Karte
                        gridSquareEastBase = Math.floor(utmBounds.minE / 100000) * 100000
                        gridSquareNorthBase = Math.floor(utmBounds.minN / 100000) * 100000
                        mapNorthMin = utmBounds.minN - gridSquareNorthBase
                        mapNorthMax = utmBounds.maxN - gridSquareNorthBase
                      } else if (activeMap?.bounds) {
                        // Berechne UTM Bounds aus den WGS84 Bounds der Karte
                        const swUtm = latLonToUTM(activeMap.bounds.south, activeMap.bounds.west, localUtmZone)
                        const neUtm = latLonToUTM(activeMap.bounds.north, activeMap.bounds.east, localUtmZone)
                        console.log('Easting: swUtm:', swUtm, 'neUtm:', neUtm)
                        gridSquareEastBase = Math.floor(Math.min(swUtm.easting, neUtm.easting) / 100000) * 100000
                        gridSquareNorthBase = Math.floor(Math.min(swUtm.northing, neUtm.northing) / 100000) * 100000
                        mapNorthMin = Math.min(swUtm.northing, neUtm.northing) - gridSquareNorthBase
                        mapNorthMax = Math.max(swUtm.northing, neUtm.northing) - gridSquareNorthBase
                      } else if (gpsData?.latitude && gpsData?.longitude) {
                        // Berechne Grid Square Base aus GPS-Position
                        const gpsUtm = latLonToUTM(gpsData.latitude, gpsData.longitude, localUtmZone)
                        gridSquareEastBase = Math.floor(gpsUtm.easting / 100000) * 100000
                        gridSquareNorthBase = Math.floor(gpsUtm.northing / 100000) * 100000
                      } else if (settings.utmBaseEasting && settings.utmBaseNorthing) {
                        gridSquareEastBase = Math.floor(settings.utmBaseEasting / 100000) * 100000
                        gridSquareNorthBase = Math.floor(settings.utmBaseNorthing / 100000) * 100000
                      } else {
                        alert('Fehler: Keine UTM-Basiskoordinaten verfügbar.')
                        return
                      }

                      // Koordinate basierend auf Koordinatenformat interpretieren
                      // Easting-Precision: mgrs4/mgrs45 = 4-stellig, mgrs6 = 6-stellig, sonst 5-stellig
                      const coordFormat = settings.coordinateFormat || 'mgrs5'
                      const inputValue = parseInt(settings.lineEastingValue || '0')
                      let eastValue: number
                      if (coordFormat === 'mgrs4' || coordFormat === 'mgrs45') {
                        eastValue = inputValue * 10
                      } else if (coordFormat === 'mgrs6') {
                        eastValue = Math.round(inputValue / 10)
                      } else {
                        eastValue = inputValue
                      }

                      // Bestimme das richtige 100km-Quadrat basierend auf den Map-Bounds
                      // Verwende den gleichen Ansatz wie das Grid: runde auf Vielfache von gridSize
                      let fullEasting = gridSquareEastBase + eastValue
                      if (hasValidUtmBounds) {
                        // Finde das 100km-Quadrat das den meisten Teil der Karte enthält
                        // Wenn minE und maxE im gleichen Quadrat liegen, verwende das
                        // Sonst verwende das Quadrat das den größeren Anteil hat
                        const minEQuadrant = Math.floor(utmBounds.minE / 100000) * 100000
                        const maxEQuadrant = Math.floor(utmBounds.maxE / 100000) * 100000

                        if (minEQuadrant === maxEQuadrant) {
                          // Karte liegt komplett in einem 100km-Quadrat
                          fullEasting = minEQuadrant + eastValue
                        } else {
                          // Karte überspannt zwei Quadrate - prüfe welches besser passt
                          const candidateInMin = minEQuadrant + eastValue
                          const candidateInMax = maxEQuadrant + eastValue

                          // Wähle das Quadrat wo der Wert in die Bounds passt
                          if (candidateInMin >= utmBounds.minE && candidateInMin <= utmBounds.maxE) {
                            fullEasting = candidateInMin
                          } else if (candidateInMax >= utmBounds.minE && candidateInMax <= utmBounds.maxE) {
                            fullEasting = candidateInMax
                          } else {
                            // Fallback: verwende das Quadrat näher am Kartenzentrum
                            const mapCenterE = (utmBounds.minE + utmBounds.maxE) / 2
                            fullEasting = Math.floor(mapCenterE / 100000) * 100000 + eastValue
                          }
                        }
                        console.log('Easting quadrant selection:', { minEQuadrant, maxEQuadrant, eastValue, fullEasting, minE: utmBounds.minE, maxE: utmBounds.maxE })
                      }

                      console.log('=== Easting Line Debug ===')
                      console.log('Input:', settings.lineEastingValue, '→ parsed:', inputValue, '→ scaled:', eastValue)
                      console.log('coordFormat:', coordFormat)
                      console.log('gridSquareEastBase:', gridSquareEastBase, 'gridSquareNorthBase:', gridSquareNorthBase)
                      console.log('fullEasting:', fullEasting)
                      console.log('UTM Zone:', localUtmZone)
                      console.log('activeMap:', activeMap?.id)
                      console.log('activeMap.utmZone:', activeMap?.utmZone)
                      console.log('activeMap.utmReprojection:', activeMap?.utmReprojection)
                      console.log('activeMap.bounds:', activeMap?.bounds)

                      // Linie über den gesamten Wettkampfbereich
                      const startNorthing = gridSquareNorthBase + mapNorthMin
                      const endNorthing = gridSquareNorthBase + mapNorthMax

                      const numSegments = 50
                      const linePoints: Array<{ latitude: number; longitude: number; altitude: number; timestamp: Date }> = []

                      for (let i = 0; i <= numSegments; i++) {
                        const northing = startNorthing + (endNorthing - startNorthing) * (i / numSegments)
                        const point = utmToLatLon({ zone: utmZone, hemisphere: 'N', easting: fullEasting, northing })
                        if (point && !isNaN(point.lat) && !isNaN(point.lon)) {
                          linePoints.push({ latitude: point.lat, longitude: point.lon, altitude: 0, timestamp: new Date() })
                        }
                      }

                      if (linePoints.length < 2) {
                        alert('Fehler: Ungültige Koordinaten.')
                        return
                      }

                      addScoringArea({
                        type: 'polygon',
                        points: linePoints,
                        color: settings.drawingLineColor || '#3b82f6',
                        fillColor: 'transparent',
                        visible: true,
                        name: `E-Line ${settings.lineEastingValue}`
                      })

                      updateSettings({ lineEastingValue: '' })
                    } catch (error) {
                      console.error('Error drawing easting line:', error)
                      alert('Fehler: ' + error)
                    }
                  }}
                  style={{ padding: '10px 16px' }}
                >
                  Draw
                </button>
              </div>
            </div>

            {/* Northing Line (EW) - Horizontale Linie */}
            <div style={{
              paddingTop: '16px',
              marginTop: '16px',
              borderTop: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '8px',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '16px' }}>↔️</span>
                Northing Line (E-W)
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                Horizontale Linie bei N-Koordinate
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={settings.lineNorthingValue ?? ''}
                    onChange={e => updateSettings({ lineNorthingValue: e.target.value.replace(/[^0-9]/g, '') })}
                    placeholder={(() => {
                      const fmt = settings.coordinateFormat || 'mgrs5'
                      if (fmt === 'mgrs4' || fmt === 'mgrs54') return 'z.B. 6000'
                      if (fmt === 'mgrs6') return 'z.B. 600000'
                      return 'z.B. 60000'
                    })()}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '6px',
                      color: '#3b82f6',
                      fontSize: '16px',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      letterSpacing: '2px',
                      textAlign: 'center'
                    }}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!settings.lineNorthingValue}
                  onClick={async () => {
                    try {
                      const { utmToLatLon, latLonToUTM } = await import('../utils/coordinatesWGS84')
                      const { useFlightStore } = await import('../stores/flightStore')

                      const state = useFlightStore.getState()
                      const gpsData = state.gpsData

                      // Aktive Wettkampfkarte direkt aus dem Store
                      const activeMap = state.activeCompetitionMap

                      // UTM Zone: Priorität 1) Map utmReprojection, 2) Map utmZone, 3) Settings
                      let localUtmZone = activeMap?.utmReprojection?.utmZone || activeMap?.utmZone || settings.utmZone

                      // Wenn Map Bounds vorhanden, berechne die UTM Zone aus dem Kartenzentrum
                      if (activeMap?.bounds && !localUtmZone) {
                        const centerLon = (activeMap.bounds.west + activeMap.bounds.east) / 2
                        localUtmZone = Math.floor((centerLon + 180) / 6) + 1
                      }
                      // Fallback auf GPS-Position für Zone-Berechnung
                      if (!localUtmZone && gpsData?.longitude) {
                        localUtmZone = Math.floor((gpsData.longitude + 180) / 6) + 1
                      }
                      localUtmZone = localUtmZone || 33

                      // Koordinate basierend auf Koordinatenformat interpretieren
                      // Northing-Precision: mgrs4/mgrs54 = 4-stellig, mgrs6 = 6-stellig, sonst 5-stellig
                      const coordFormat = settings.coordinateFormat || 'mgrs5'
                      const inputValue = parseInt(settings.lineNorthingValue || '0')
                      let northValue: number
                      if (coordFormat === 'mgrs4' || coordFormat === 'mgrs54') {
                        northValue = inputValue * 10
                      } else if (coordFormat === 'mgrs6') {
                        northValue = Math.round(inputValue / 10)
                      } else {
                        northValue = inputValue
                      }

                      // Grid Square Base und Easting-Bereich berechnen
                      // WICHTIG: Verwende latLonToUTM auf WGS84-Bounds, genau wie das Grid es tut
                      // Das stellt sicher dass die Linien exakt auf dem Grid liegen
                      let gridSquareEastBase = 0
                      let gridSquareNorthBase = 0
                      let mapEastMin = 0
                      let mapEastMax = 99999
                      let calculatedMinE = 0
                      let calculatedMaxE = 0
                      let calculatedMinN = 0
                      let calculatedMaxN = 0

                      if (activeMap?.bounds) {
                        // Berechne UTM Bounds aus den WGS84 Bounds der Karte
                        // GENAU WIE das Grid in MapView es tut - das stellt Konsistenz sicher
                        const swUtm = latLonToUTM(activeMap.bounds.south, activeMap.bounds.west, localUtmZone)
                        const seUtm = latLonToUTM(activeMap.bounds.south, activeMap.bounds.east, localUtmZone)
                        const nwUtm = latLonToUTM(activeMap.bounds.north, activeMap.bounds.west, localUtmZone)
                        const neUtm = latLonToUTM(activeMap.bounds.north, activeMap.bounds.east, localUtmZone)

                        calculatedMinE = Math.min(swUtm.easting, seUtm.easting, nwUtm.easting, neUtm.easting)
                        calculatedMaxE = Math.max(swUtm.easting, seUtm.easting, nwUtm.easting, neUtm.easting)
                        calculatedMinN = Math.min(swUtm.northing, seUtm.northing, nwUtm.northing, neUtm.northing)
                        calculatedMaxN = Math.max(swUtm.northing, seUtm.northing, nwUtm.northing, neUtm.northing)

                        console.log('Northing: calculated UTM bounds:', { calculatedMinE, calculatedMaxE, calculatedMinN, calculatedMaxN })

                        gridSquareEastBase = Math.floor(calculatedMinE / 100000) * 100000
                        gridSquareNorthBase = Math.floor(calculatedMinN / 100000) * 100000
                        mapEastMin = calculatedMinE - gridSquareEastBase
                        mapEastMax = calculatedMaxE - gridSquareEastBase
                      } else if (gpsData?.latitude && gpsData?.longitude) {
                        // Berechne Grid Square Base aus GPS-Position
                        const gpsUtm = latLonToUTM(gpsData.latitude, gpsData.longitude, localUtmZone)
                        gridSquareEastBase = Math.floor(gpsUtm.easting / 100000) * 100000
                        gridSquareNorthBase = Math.floor(gpsUtm.northing / 100000) * 100000
                      } else if (settings.utmBaseEasting && settings.utmBaseNorthing) {
                        gridSquareEastBase = Math.floor(settings.utmBaseEasting / 100000) * 100000
                        gridSquareNorthBase = Math.floor(settings.utmBaseNorthing / 100000) * 100000
                      } else {
                        alert('Fehler: Keine UTM-Basiskoordinaten verfügbar.')
                        return
                      }

                      // Berechne fullNorthing direkt aus dem 100km-Quadrat
                      let fullNorthing = gridSquareNorthBase + northValue

                      // Wenn die Map zwei 100km-Quadrate überspannt, wähle das richtige
                      if (calculatedMinN > 0 && calculatedMaxN > 0) {
                        const minNQuadrant = Math.floor(calculatedMinN / 100000) * 100000
                        const maxNQuadrant = Math.floor(calculatedMaxN / 100000) * 100000

                        if (minNQuadrant !== maxNQuadrant) {
                          // Karte überspannt zwei Quadrate - prüfe welches besser passt
                          const candidateInMin = minNQuadrant + northValue
                          const candidateInMax = maxNQuadrant + northValue

                          if (candidateInMax >= calculatedMinN && candidateInMax <= calculatedMaxN) {
                            fullNorthing = candidateInMax
                          } else if (candidateInMin >= calculatedMinN && candidateInMin <= calculatedMaxN) {
                            fullNorthing = candidateInMin
                          }
                        }
                      }
                      console.log('Northing final:', { gridSquareNorthBase, northValue, fullNorthing })

                      console.log('=== Northing Line Debug ===')
                      console.log('Input:', settings.lineNorthingValue, '→ parsed:', inputValue, '→ scaled:', northValue)
                      console.log('coordFormat:', coordFormat)
                      console.log('gridSquareNorthBase:', gridSquareNorthBase, 'gridSquareEastBase:', gridSquareEastBase)
                      console.log('fullNorthing:', fullNorthing)
                      console.log('UTM Zone:', localUtmZone)
                      console.log('activeMap:', activeMap?.id)
                      console.log('activeMap.utmZone:', activeMap?.utmZone)
                      console.log('activeMap.utmReprojection:', activeMap?.utmReprojection)
                      console.log('activeMap.bounds:', activeMap?.bounds)

                      // Linie über den gesamten Wettkampfbereich
                      const startEasting = gridSquareEastBase + mapEastMin
                      const endEasting = gridSquareEastBase + mapEastMax

                      // Viele Zwischenpunkte entlang konstanter UTM-Northing = Linie biegt sich mit dem Grid
                      const numSegments = 100
                      const linePoints: Array<{ latitude: number; longitude: number; altitude: number; timestamp: Date }> = []

                      // Debug: Teste utmToLatLon mit einem Punkt in der Mitte
                      const testEasting = (startEasting + endEasting) / 2
                      const testPoint = utmToLatLon({ zone: utmZone, hemisphere: 'N', easting: testEasting, northing: fullNorthing })
                      console.log('Test UTM->LatLon: easting=' + testEasting + ', northing=' + fullNorthing + ', zone=' + utmZone + ' => lat=' + testPoint.lat + ', lon=' + testPoint.lon)

                      for (let i = 0; i <= numSegments; i++) {
                        const easting = startEasting + (endEasting - startEasting) * (i / numSegments)
                        const point = utmToLatLon({ zone: utmZone, hemisphere: 'N', easting, northing: fullNorthing })
                        if (point && !isNaN(point.lat) && !isNaN(point.lon)) {
                          linePoints.push({ latitude: point.lat, longitude: point.lon, altitude: 0, timestamp: new Date() })
                        }
                      }

                      if (linePoints.length < 2) {
                        alert('Fehler: Ungültige Koordinaten.')
                        return
                      }

                      addScoringArea({
                        type: 'polygon',
                        points: linePoints,
                        color: settings.drawingLineColor || '#3b82f6',
                        fillColor: 'transparent',
                        visible: true,
                        name: `N-Line ${settings.lineNorthingValue}`
                      })

                      updateSettings({ lineNorthingValue: '' })
                    } catch (error) {
                      console.error('Error drawing northing line:', error)
                      alert('Fehler: ' + error)
                    }
                  }}
                  style={{ padding: '10px 16px' }}
                >
                  Draw
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Saved Areas List */}
        {scoringAreas && scoringAreas.length > 0 && (
          <div>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '12px',
              color: 'white'
            }}>
              Gespeicherte Areas ({scoringAreas.length})
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {scoringAreas.map((area) => (
                <div
                  key={area.id}
                  style={{
                    padding: '12px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flex: 1
                  }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: area.color || '#3b82f6'
                    }} />
                    <div>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'white'
                      }}>
                        {area.name || `${area.type} Area`}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: 'rgba(255,255,255,0.4)'
                      }}>
                        {area.type === 'circle' && `Radius: ${area.radius}m`}
                        {area.type === 'polygon' && `${area.points?.length || 0} Punkte`}
                        {area.type === 'sector' && `${area.startAngle}° - ${area.endAngle}°`}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => area.id && removeScoringArea(area.id)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '14px',
                      cursor: 'pointer',
                      padding: '6px 10px',
                      borderRadius: '6px'
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
