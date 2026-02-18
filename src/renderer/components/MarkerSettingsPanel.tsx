import React from 'react'
import { useFlightStore } from '../stores/flightStore'

interface MarkerSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function MarkerSettingsPanel({ isOpen, onClose }: MarkerSettingsPanelProps) {
  const { settings, updateSettings } = useFlightStore()

  if (!isOpen) return null

  return (
    <div style={{
      position: 'absolute',
      top: 80,
      right: 16,
      width: '300px',
      background: 'var(--bg-primary)',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      border: '1px solid var(--border-color)',
      zIndex: 1002,
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-secondary)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>📍</span>
          <span style={{ fontWeight: 600, fontSize: '15px' }}>Positionsmarker</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            padding: '4px 8px'
          }}
        >
          ✕
        </button>
      </div>

      {/* Einstellungen */}
      <div style={{
        padding: '16px'
      }}>
        {/* Größe */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Größe
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['small', 'medium', 'large'] as const).map((size) => (
              <button
                key={size}
                onClick={() => updateSettings({ balloonMarkerSize: size })}
                style={{
                  flex: 1,
                  padding: '10px',
                  fontSize: '12px',
                  background: (settings.balloonMarkerSize || 'medium') === size ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                  color: (settings.balloonMarkerSize || 'medium') === size ? 'white' : 'var(--text-primary)',
                  border: (settings.balloonMarkerSize || 'medium') === size ? 'none' : '1px solid var(--border-color)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: (settings.balloonMarkerSize || 'medium') === size ? 600 : 400,
                  textTransform: 'capitalize'
                }}
              >
                {size === 'small' ? 'Klein' : size === 'medium' ? 'Mittel' : 'Groß'}
              </button>
            ))}
          </div>
        </div>

        {/* Pfeil-Stil */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Pfeil-Stil
          </div>
          <div style={{
            fontSize: '10px',
            color: 'var(--color-secondary)',
            marginBottom: '10px',
            padding: '6px 8px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ fontSize: '12px' }}>📍</span>
            Die Spitze des Cursors zeigt immer die exakte GPS-Position an
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {(['arrow', 'triangle', 'dart', 'pointer'] as const).map((style) => {
              const labels = {
                arrow: '⬆️ Standard',
                triangle: '🔺 Dreieck',
                dart: '➤ Dart',
                pointer: '▲ Spitz'
              }

              return (
                <button
                  key={style}
                  onClick={() => updateSettings({ balloonMarkerIcon: style })}
                  style={{
                    padding: '12px',
                    fontSize: '13px',
                    background: (settings.balloonMarkerIcon || 'arrow') === style ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                    color: (settings.balloonMarkerIcon || 'arrow') === style ? 'white' : 'var(--text-primary)',
                    border: (settings.balloonMarkerIcon || 'arrow') === style ? 'none' : '1px solid var(--border-color)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: (settings.balloonMarkerIcon || 'arrow') === style ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  {labels[style]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Farbe */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Farbe
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[
              { color: '#e74c3c', label: 'Rot' },
              { color: '#3b82f6', label: 'Blau' },
              { color: '#22c55e', label: 'Grün' },
              { color: '#f59e0b', label: 'Orange' },
              { color: '#ec4899', label: 'Pink' },
              { color: '#a855f7', label: 'Lila' },
              { color: '#14b8a6', label: 'Türkis' },
              { color: '#ffffff', label: 'Weiß' }
            ].map(({ color, label }) => (
              <button
                key={color}
                onClick={() => updateSettings({ balloonMarkerColor: color })}
                style={{
                  padding: '12px',
                  background: (settings.balloonMarkerColor || '#e74c3c') === color ? color : 'var(--bg-tertiary)',
                  border: (settings.balloonMarkerColor || '#e74c3c') === color ? '3px solid white' : `3px solid ${color}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  boxShadow: (settings.balloonMarkerColor || '#e74c3c') === color ? `0 0 12px ${color}` : 'none',
                  transition: 'all 0.2s'
                }}
                title={label}
              />
            ))}
          </div>
        </div>

        {/* Heading-Linie */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Richtungslinie
            </div>
            <button
              onClick={() => updateSettings({ balloonHeadingLine: !settings.balloonHeadingLine })}
              style={{
                padding: '4px 12px',
                fontSize: '11px',
                background: settings.balloonHeadingLine ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                color: settings.balloonHeadingLine ? 'white' : 'var(--text-primary)',
                border: settings.balloonHeadingLine ? 'none' : '1px solid var(--border-color)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {settings.balloonHeadingLine ? 'AN' : 'AUS'}
            </button>
          </div>
          {settings.balloonHeadingLine && (
            <div>
              {/* Länge */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '6px'
                }}>
                  Länge: {settings.balloonHeadingLineLength || 1000}m
                </div>
                <input
                  type="range"
                  min="100"
                  max="5000"
                  step="100"
                  value={settings.balloonHeadingLineLength || 1000}
                  onChange={(e) => updateSettings({ balloonHeadingLineLength: parseInt(e.target.value) })}
                  style={{
                    width: '100%',
                    cursor: 'pointer'
                  }}
                />
              </div>

              {/* Stärke */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '6px'
                }}>
                  Stärke: {settings.balloonHeadingLineWidth || 2}px
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={settings.balloonHeadingLineWidth || 2}
                  onChange={(e) => updateSettings({ balloonHeadingLineWidth: parseInt(e.target.value) })}
                  style={{
                    width: '100%',
                    cursor: 'pointer'
                  }}
                />
              </div>

              {/* Farbe */}
              <div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '6px'
                }}>
                  Farbe
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {[
                    { color: '#e74c3c', label: 'Rot' },
                    { color: '#3b82f6', label: 'Blau' },
                    { color: '#22c55e', label: 'Grün' },
                    { color: '#f59e0b', label: 'Orange' },
                    { color: '#ec4899', label: 'Pink' },
                    { color: '#a855f7', label: 'Lila' },
                    { color: '#14b8a6', label: 'Türkis' },
                    { color: '#ffffff', label: 'Weiß' }
                  ].map(({ color, label }) => (
                    <button
                      key={color}
                      onClick={() => updateSettings({ balloonHeadingLineColor: color })}
                      style={{
                        padding: '10px',
                        background: (settings.balloonHeadingLineColor || settings.balloonMarkerColor || '#e74c3c') === color ? color : 'var(--bg-tertiary)',
                        border: (settings.balloonHeadingLineColor || settings.balloonMarkerColor || '#e74c3c') === color ? '2px solid white' : `2px solid ${color}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        boxShadow: (settings.balloonHeadingLineColor || settings.balloonMarkerColor || '#e74c3c') === color ? `0 0 8px ${color}` : 'none',
                        transition: 'all 0.2s'
                      }}
                      title={label}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Vorschau */}
        <div style={{
          marginTop: '16px',
          padding: '16px',
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Vorschau
          </div>
          <div style={{
            display: 'inline-block',
            background: 'rgba(255,255,255,0.1)',
            padding: '20px',
            borderRadius: '8px'
          }}>
            <div dangerouslySetInnerHTML={{
              __html: (() => {
                const sizes = {
                  small: { width: 24, height: 24 },
                  medium: { width: 32, height: 32 },
                  large: { width: 48, height: 48 }
                }
                const markerSize = settings.balloonMarkerSize || 'medium'
                const markerIcon = settings.balloonMarkerIcon || 'arrow'
                const markerColor = settings.balloonMarkerColor || '#e74c3c'
                const { width, height } = sizes[markerSize]

                let arrowPath = ''
                switch (markerIcon) {
                  case 'arrow':
                    arrowPath = 'M16 2 L28 22 L22 22 L22 30 L10 30 L10 22 L4 22 Z'
                    break
                  case 'triangle':
                    arrowPath = 'M16 2 L30 28 L2 28 Z'
                    break
                  case 'dart':
                    arrowPath = 'M16 2 L26 16 L16 24 L6 16 Z'
                    break
                  case 'pointer':
                    arrowPath = 'M16 2 L28 30 L16 22 L4 30 Z'
                    break
                  default:
                    arrowPath = 'M16 2 L28 22 L22 22 L22 30 L10 30 L10 22 L4 22 Z'
                }

                return `
                  <svg width="${width}" height="${height}" viewBox="0 0 32 32" fill="none">
                    <path d="${arrowPath}" fill="${markerColor}" stroke="#fff" stroke-width="2"/>
                  </svg>
                `
              })()
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}
