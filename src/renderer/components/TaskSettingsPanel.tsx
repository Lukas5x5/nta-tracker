import React, { useState, useEffect, useRef } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { AppSettings } from '../../shared/types'

interface TaskSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab = 'einheiten' | 'koordinaten' | 'pilot' | 'mma' | 'utm' | 'navigation' | 'taskrings' | 'kurslinien' | 'windlinien' | 'ballon' | 'farben' | 'sperrgebiete' | 'pzwarnung' | 'erinnerung' | 'audio' | 'uigroesse' | 'taskicon' | 'tasklabel' | 'aufzeichnung' | 'zeichnen'

const TABS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: 'einheiten', label: 'Einheiten', icon: 'M3 6h18M3 12h18M3 18h18' },
  { key: 'koordinaten', label: 'Koordinaten', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' },
  { key: 'pilot', label: 'Pilot', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { key: 'mma', label: 'MMA', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z' },
  { key: 'utm', label: 'UTM Grid', icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18' },
  { key: 'navigation', label: 'Navigation', icon: 'M3 11l19-9-9 19-2-8-8-2z' },
  { key: 'taskrings', label: 'Task Rings', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 18c3.314 0 6-2.686 6-6s-2.686-6-6-6-6 2.686-6 6 2.686 6 6 6z' },
  { key: 'kurslinien', label: 'Kurslinien', icon: 'M12 2L12 22M2 12h20' },
  { key: 'windlinien', label: 'Wind-Linien', icon: 'M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2' },
  { key: 'ballon', label: 'Positionsmarker', icon: 'M12 2a7 7 0 0 0-7 7c0 5 7 11 7 11s7-6 7-11a7 7 0 0 0-7-7z' },
  { key: 'farben', label: 'Farben', icon: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z' },
  { key: 'sperrgebiete', label: 'Sperrgebiete', icon: 'M12 2L22 8.5V15.5L12 22L2 15.5V8.5L12 2Z' },
  { key: 'audio', label: 'Audio', icon: 'M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07' },
  { key: 'uigroesse', label: 'UI Größe', icon: 'M21 3H3v18h18V3zM3 9h18M9 21V9' },
  { key: 'taskicon', label: 'Task Icon', icon: 'M12 5v14M5 12h14' },
  { key: 'tasklabel', label: 'Task Label', icon: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z' },
  { key: 'aufzeichnung', label: 'Aufzeichnung', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z' },
  { key: 'zeichnen', label: 'Zeichnen', icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586' }
]

export function TaskSettingsPanel({ isOpen, onClose }: TaskSettingsPanelProps) {
  const { settings, updateSettings } = useFlightStore()

  const [activeTab, setActiveTab] = useState<SettingsTab>('koordinaten')
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [qnhEditing, setQnhEditing] = useState(false)
  const initialSettingsRef = useRef<string>('')

  useEffect(() => {
    if (isOpen) {
      initialSettingsRef.current = JSON.stringify(settings)
      setHasChanges(false)
    }
  }, [isOpen])

  const updateLocalSettings = (newSettings: Partial<AppSettings>) => {
    updateSettings(newSettings)
    setHasChanges(true)
  }

  const handleSaveAndClose = () => {
    setHasChanges(false)
    setShowConfirmDialog(false)
    onClose()
  }

  const handleDiscardAndClose = () => {
    if (initialSettingsRef.current) {
      const original = JSON.parse(initialSettingsRef.current)
      updateSettings(original)
    }
    setHasChanges(false)
    setShowConfirmDialog(false)
    onClose()
  }

  const handleClose = () => {
    if (hasChanges) {
      setShowConfirmDialog(true)
    } else {
      onClose()
    }
  }

  if (!isOpen) return null

  // ═══════════════════════════════════════════
  // Render Content based on active tab
  // ═══════════════════════════════════════════
  const renderContent = () => {
    switch (activeTab) {
      case 'einheiten':
        // Segmented Control Style mit abgerundeten Pill-Buttons
        const segmentedRow = (label: string, options: { key: string; label: string }[], currentValue: string, onChange: (key: string) => void) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>{label}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {options.map(opt => (
                <button key={opt.key} onClick={() => onChange(opt.key)} style={{
                  padding: '7px 16px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                  borderRadius: '20px',
                  background: currentValue === opt.key ? 'rgba(59,130,246,1)' : 'rgba(255,255,255,0.08)',
                  color: currentValue === opt.key ? '#fff' : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.2s ease',
                  boxShadow: currentValue === opt.key ? '0 2px 8px rgba(59,130,246,0.4)' : 'none'
                }}>{opt.label}</button>
              ))}
            </div>
          </div>
        )
        return (
          <div>
            {segmentedRow('Höhe', [{ key: 'meters', label: 'm' }, { key: 'feet', label: 'ft' }], settings.altitudeUnit, k => updateLocalSettings({ altitudeUnit: k as any }))}
            {segmentedRow('Distanz', [{ key: 'meters', label: 'm' }, { key: 'feet', label: 'ft' }, { key: 'nm', label: 'NM' }], settings.distanceUnit, k => updateLocalSettings({ distanceUnit: k as any }))}
            {segmentedRow('Geschwindigkeit', [{ key: 'kmh', label: 'km/h' }, { key: 'ms', label: 'm/s' }, { key: 'knots', label: 'kn' }], settings.speedUnit, k => updateLocalSettings({ speedUnit: k as any }))}
            {segmentedRow('Variometer', [{ key: 'ms', label: 'm/s' }, { key: 'fpm', label: 'ft/min' }], settings.variometerUnit, k => updateLocalSettings({ variometerUnit: k as any }))}
            {segmentedRow('Druck', [{ key: 'hPa', label: 'hPa' }, { key: 'inHg', label: 'inHg' }], settings.pressureUnit, k => updateLocalSettings({ pressureUnit: k as any }))}

            {/* QNH - Gesperrt bis Edit-Button geklickt */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>QNH</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {qnhEditing ? (
                  <>
                    <input type="number" min="900" max="1100" step="1" value={settings.qnh || 1013}
                      onChange={e => updateLocalSettings({ qnh: parseInt(e.target.value) || 1013 })}
                      autoFocus
                      onBlur={() => setQnhEditing(false)}
                      onKeyDown={e => e.key === 'Enter' && setQnhEditing(false)}
                      style={{
                        width: '80px', padding: '7px 12px', borderRadius: '20px', border: '2px solid #3b82f6',
                        background: 'rgba(59,130,246,0.1)', color: '#fff',
                        fontSize: '13px', fontWeight: 600, textAlign: 'center', outline: 'none'
                      }} />
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>hPa</span>
                  </>
                ) : (
                  <>
                    <span style={{
                      padding: '7px 16px', fontSize: '13px', fontWeight: 600,
                      background: 'rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.7)'
                    }}>{settings.qnh || 1013} hPa</span>
                    <button onClick={() => setQnhEditing(true)} style={{
                      padding: '6px 10px', fontSize: '11px', fontWeight: 600, border: 'none', cursor: 'pointer',
                      borderRadius: '16px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                      transition: 'all 0.2s'
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ verticalAlign: 'middle' }}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Zeit Section */}
            <div style={{ marginTop: '20px', paddingTop: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Zeit</div>
              {segmentedRow('Zeitzone', [{ key: 'utc', label: 'UTC' }, { key: 'local', label: 'Lokal' }], settings.taskTimeZone || 'utc', k => updateLocalSettings({ taskTimeZone: k as any }))}
            </div>

            {/* Wind Section */}
            <div style={{ marginTop: '20px', paddingTop: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Wind</div>
              {segmentedRow('Geschwindigkeit', [{ key: 'kmh', label: 'km/h' }, { key: 'ms', label: 'm/s' }], settings.windSpeedUnit, k => updateLocalSettings({ windSpeedUnit: k as any }))}
              {segmentedRow('Richtung', [{ key: 'from', label: 'Von' }, { key: 'to', label: 'Zu' }], settings.windDirectionMode, k => updateLocalSettings({ windDirectionMode: k as any }))}
              {segmentedRow('Höhenanzeige', [{ key: 'm', label: 'm' }, { key: 'ft', label: 'ft' }], settings.windAltitudeUnit, k => updateLocalSettings({ windAltitudeUnit: k as any }))}
              {segmentedRow('Intervall',
                settings.windAltitudeUnit === 'ft'
                  ? [{ key: '100', label: '100ft' }, { key: '200', label: '200ft' }, { key: '500', label: '500ft' }, { key: '1000', label: '1000ft' }]
                  : [{ key: '50', label: '50m' }, { key: '100', label: '100m' }, { key: '200', label: '200m' }, { key: '500', label: '500m' }],
                String(settings.windLayerInterval),
                k => updateLocalSettings({ windLayerInterval: Number(k) as any })
              )}
            </div>
          </div>
        )

      case 'pilot':
        return (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Pilotname</div>
              <input type="text" value={settings.pilotName || ''}
                onChange={e => updateLocalSettings({ pilotName: e.target.value })}
                placeholder="Dein Name"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Ballon ID</div>
              <input type="text" value={settings.balloonId || ''}
                onChange={e => updateLocalSettings({ balloonId: e.target.value })}
                placeholder="z.B. OE-ZAB"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>

            {/* BLS Sensor */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px', fontWeight: 600 }}>BLS Sensor</div>

              {settings.lastConnectedBLSName ? (
                <div style={{ padding: '12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>Letzter Sensor</div>
                  <div style={{ fontSize: '14px', color: 'white', marginTop: '4px' }}>{settings.lastConnectedBLSName}</div>
                  <button onClick={() => updateLocalSettings({ lastConnectedBLS: null, lastConnectedBLSName: null })} style={{
                    marginTop: '8px', padding: '6px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '6px', color: '#ef4444', fontSize: '11px', cursor: 'pointer'
                  }}>Vergessen</button>
                </div>
              ) : (
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                  Kein BLS Sensor verbunden
                </div>
              )}
            </div>
          </div>
        )

      case 'koordinaten':
        // Pill button style
        const coordBtn = (active: boolean): React.CSSProperties => ({
          padding: '7px 16px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
          borderRadius: '20px',
          background: active ? 'rgba(59,130,246,1)' : 'rgba(255,255,255,0.08)',
          color: active ? '#fff' : 'rgba(255,255,255,0.5)',
          transition: 'all 0.2s ease',
          boxShadow: active ? '0 2px 8px rgba(59,130,246,0.4)' : 'none'
        })
        return (
          <div>
            {/* Koordinatenformat */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>Format</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { key: 'decimal', label: 'DD' },
                  { key: 'dm', label: 'DM' },
                  { key: 'dms', label: 'DMS' }
                ].map(f => (
                  <button key={f.key} onClick={() => updateLocalSettings({ coordinateFormat: f.key as any })} style={coordBtn(settings.coordinateFormat === f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* UTM Format */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>UTM</span>
              <button onClick={() => updateLocalSettings({ coordinateFormat: 'utm' })} style={coordBtn(settings.coordinateFormat === 'utm')}>
                UTM
              </button>
            </div>

            {/* MGRS Format */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>MGRS</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { key: 'mgrs4', label: '4/4' },
                  { key: 'mgrs45', label: '4/5' },
                  { key: 'mgrs54', label: '5/4' },
                  { key: 'mgrs5', label: '5/5' }
                ].map(f => (
                  <button key={f.key} onClick={() => updateLocalSettings({ coordinateFormat: f.key as any })} style={coordBtn(settings.coordinateFormat === f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* UTM Zone Section */}
            <div style={{ marginTop: '20px', paddingTop: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>UTM Zone</div>

              {/* Zone */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>Zone</span>
                <select
                  value={settings.utmZone || 33}
                  onChange={e => updateLocalSettings({ utmZone: parseInt(e.target.value) })}
                  style={{
                    padding: '7px 12px', borderRadius: '20px', border: 'none',
                    background: 'rgba(255,255,255,0.08)', color: '#fff',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', outline: 'none'
                  }}
                >
                  {Array.from({ length: 60 }, (_, i) => i + 1).map(zone => (
                    <option key={zone} value={zone} style={{ background: '#1e293b', color: '#fff' }}>{zone}</option>
                  ))}
                </select>
              </div>

              {/* Band */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>Band</span>
                <select
                  value={settings.utmBand || 'U'}
                  onChange={e => updateLocalSettings({ utmBand: e.target.value })}
                  style={{
                    padding: '7px 12px', borderRadius: '20px', border: 'none',
                    background: 'rgba(255,255,255,0.08)', color: '#fff',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', outline: 'none'
                  }}
                >
                  {['C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'].map(band => (
                    <option key={band} value={band} style={{ background: '#1e293b', color: '#fff' }}>{band}</option>
                  ))}
                </select>
              </div>

              {/* Preview */}
              <div style={{
                marginTop: '12px', padding: '12px 16px',
                background: 'rgba(59,130,246,0.1)', borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#3b82f6' }}>
                  {settings.utmZone || 33}{settings.utmBand || 'U'}
                </span>
              </div>
            </div>
          </div>
        )

      case 'mma':
        return (
          <div>
            {/* Standard Radius */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>
                Standard Radius (m)
              </div>
              <input type="number" min="1" max="200" step="1" value={settings.defaultMmaRadius || 100}
                onChange={e => updateLocalSettings({ defaultMmaRadius: Math.max(1, Math.min(200, parseInt(e.target.value) || 1)) })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#f59e0b', fontSize: '14px', fontWeight: 600, textAlign: 'center', boxSizing: 'border-box' }} />
            </div>

            {/* Linienfarbe */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>Linienfarbe</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label style={{
                  width: '50px', height: '50px', borderRadius: '50%',
                  background: settings.defaultMmaLineColor || '#ffffff',
                  border: '3px solid rgba(255,255,255,0.3)',
                  cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                  position: 'relative', overflow: 'hidden'
                }}>
                  <input type="color" value={settings.defaultMmaLineColor || '#ffffff'}
                    onChange={e => updateLocalSettings({ defaultMmaLineColor: e.target.value })}
                    style={{ position: 'absolute', width: '200%', height: '200%', top: '-50%', left: '-50%', cursor: 'pointer', opacity: 0 }} />
                </label>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Individuell wählbar</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{(settings.defaultMmaLineColor || '#ffffff').toUpperCase()}</div>
                </div>
              </div>
            </div>

            {/* Linienstil */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>Linienstil</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => updateLocalSettings({ mmaBorderDashed: false })} style={{
                  flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                  background: !settings.mmaBorderDashed ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                }}>
                  Durchgezogen
                </button>
                <button onClick={() => updateLocalSettings({ mmaBorderDashed: true })} style={{
                  flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                  background: settings.mmaBorderDashed ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                }}>
                  Gestrichelt
                </button>
              </div>
            </div>

            {/* Füllung */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>Füllung</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => updateLocalSettings({ mmaFillEnabled: false })} style={{
                  flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                  background: !settings.mmaFillEnabled ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                }}>
                  Ohne
                </button>
                <button onClick={() => updateLocalSettings({ mmaFillEnabled: true })} style={{
                  flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                  background: settings.mmaFillEnabled ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                }}>
                  Mit Füllung
                </button>
              </div>
            </div>

            {settings.mmaFillEnabled && (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>Füllmodus</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => updateLocalSettings({ mmaFillDashed: false })} style={{
                      flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                      background: !settings.mmaFillDashed ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                      color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                    }}>
                      Gefüllt
                    </button>
                    <button onClick={() => updateLocalSettings({ mmaFillDashed: true })} style={{
                      flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                      background: settings.mmaFillDashed ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                      color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                    }}>
                      Schraffiert
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>Füllfarbe</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{
                      width: '50px', height: '50px', borderRadius: '50%',
                      background: settings.defaultMmaFillColor || '#ffffff',
                      border: '3px solid rgba(255,255,255,0.3)',
                      cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                      position: 'relative', overflow: 'hidden', opacity: 0.7
                    }}>
                      <input type="color" value={settings.defaultMmaFillColor || '#ffffff'}
                        onChange={e => updateLocalSettings({ defaultMmaFillColor: e.target.value })}
                        style={{ position: 'absolute', width: '200%', height: '200%', top: '-50%', left: '-50%', cursor: 'pointer', opacity: 0 }} />
                    </label>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Individuell wählbar</div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{(settings.defaultMmaFillColor || '#ffffff').toUpperCase()}</div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Vorschau */}
            <div style={{ padding: '20px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="120" height="120" style={{ overflow: 'visible' }}>
                {settings.mmaFillEnabled && settings.mmaFillDashed && (
                  <defs>
                    <clipPath id="mma-preview-clip">
                      <circle cx="60" cy="60" r="50" />
                    </clipPath>
                  </defs>
                )}
                <circle cx="60" cy="60" r="50"
                  fill={settings.mmaFillEnabled && !settings.mmaFillDashed ? `${settings.defaultMmaFillColor || '#ffffff'}40` : 'none'}
                  stroke={settings.defaultMmaLineColor || '#ffffff'}
                  strokeWidth="2"
                  strokeDasharray={settings.mmaBorderDashed ? '6,4' : undefined} />
                {settings.mmaFillEnabled && settings.mmaFillDashed && (
                  <g clipPath="url(#mma-preview-clip)" opacity="0.4">
                    {Array.from({ length: 12 }, (_, i) => {
                      const offset = (i - 6) * 12
                      return <line key={i} x1={60 + offset - 50} y1={10} x2={60 + offset + 50} y2={110} stroke={settings.defaultMmaFillColor || '#ffffff'} strokeWidth="1.5" />
                    })}
                  </g>
                )}
                <line x1="55" y1="60" x2="65" y2="60" stroke={settings.defaultMmaLineColor || '#ffffff'} strokeWidth="2" />
                <line x1="60" y1="55" x2="60" y2="65" stroke={settings.defaultMmaLineColor || '#ffffff'} strokeWidth="2" />
                <text x="60" y="85" fill="rgba(255,255,255,0.5)" fontSize="10" textAnchor="middle">{settings.defaultMmaRadius || 100}m</text>
              </svg>
            </div>
          </div>
        )

      case 'utm':
        const utmToggleRow = (label: string, checked: boolean, onChange: (checked: boolean) => void) => (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)'
          }}>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>{label}</span>
            <button
              onClick={() => onChange(!checked)}
              style={{
                padding: '7px 20px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                borderRadius: '20px',
                background: checked ? 'rgba(34,197,94,1)' : 'rgba(255,255,255,0.08)',
                color: checked ? '#fff' : 'rgba(255,255,255,0.5)',
                transition: 'all 0.2s ease',
                boxShadow: checked ? '0 2px 8px rgba(34,197,94,0.4)' : 'none'
              }}
            >
              {checked ? 'An' : 'Aus'}
            </button>
          </div>
        )

        const utmGridSizeRow = () => (
          <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Grid-Größe</span>
              <span style={{ fontSize: '12px', color: 'rgba(59,130,246,1)', fontWeight: 600 }}>
                {(settings.gridSize || 100) >= 1000 ? `${(settings.gridSize || 100) / 1000} km` : `${settings.gridSize || 100} m`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[50, 100, 200, 500, 1000, 2000].map(size => (
                <button key={size} onClick={() => updateLocalSettings({ gridSize: size })} style={{
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: '20px',
                  background: settings.gridSize === size ? 'rgba(59,130,246,1)' : 'rgba(255,255,255,0.08)',
                  color: settings.gridSize === size ? '#fff' : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.2s ease',
                  boxShadow: settings.gridSize === size ? '0 2px 8px rgba(59,130,246,0.4)' : 'none'
                }}>
                  {size >= 1000 ? `${size / 1000}km` : `${size}m`}
                </button>
              ))}
            </div>
          </div>
        )

        const utmSliderRow = (label: string, value: number, min: number, max: number, step: number, displayValue: string, onChange: (val: number) => void) => (
          <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>{label}</span>
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#fff',
                background: 'rgba(59,130,246,0.3)',
                padding: '4px 12px',
                borderRadius: '12px'
              }}>{displayValue}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={e => onChange(parseFloat(e.target.value))}
              style={{
                width: '100%',
                cursor: 'pointer',
                height: '6px',
                borderRadius: '3px',
                background: `linear-gradient(to right, rgba(59,130,246,1) 0%, rgba(59,130,246,1) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) 100%)`,
                WebkitAppearance: 'none',
                appearance: 'none'
              }}
            />
          </div>
        )

        const utmColorRow = () => (
          <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Grid Farbe</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                background: settings.gridLineColor || '#3b82f6',
                border: '3px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <input
                  type="color"
                  value={settings.gridLineColor || '#3b82f6'}
                  onChange={e => updateLocalSettings({ gridLineColor: e.target.value })}
                  style={{
                    position: 'absolute',
                    width: '200%',
                    height: '200%',
                    top: '-50%',
                    left: '-50%',
                    cursor: 'pointer',
                    opacity: 0
                  }}
                />
              </label>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Individuell wählbar</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{(settings.gridLineColor || '#3b82f6').toUpperCase()}</div>
              </div>
            </div>
          </div>
        )

        return (
          <div>
            {utmToggleRow('Grid anzeigen', settings.showGrid || false, (checked) => updateLocalSettings({ showGrid: checked }))}

            {settings.showGrid && (
              <>
                {utmGridSizeRow()}
                {utmColorRow()}
                {utmSliderRow(
                  'Deckkraft',
                  settings.gridLineOpacity || 0.6,
                  0.1, 1, 0.1,
                  `${Math.round((settings.gridLineOpacity || 0.6) * 100)}%`,
                  (val) => updateLocalSettings({ gridLineOpacity: val })
                )}
                {utmSliderRow(
                  'Linienbreite',
                  settings.gridLineWidth || 1,
                  0.5, 3, 0.5,
                  `${settings.gridLineWidth || 1} px`,
                  (val) => updateLocalSettings({ gridLineWidth: val })
                )}
                {utmToggleRow('Koordinaten-Labels', settings.showGridLabels || false, (checked) => updateLocalSettings({ showGridLabels: checked }))}

                {/* Vorschau */}
                <div style={{
                  marginTop: '16px',
                  padding: '20px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1px' }}>Vorschau</span>
                  <svg width="120" height="120" style={{ overflow: 'visible' }}>
                    {/* Grid lines */}
                    {[0, 40, 80, 120].map(pos => (
                      <g key={pos}>
                        <line
                          x1={pos} y1="0" x2={pos} y2="120"
                          stroke={settings.gridLineColor || '#3b82f6'}
                          strokeWidth={settings.gridLineWidth || 1}
                          strokeOpacity={settings.gridLineOpacity || 0.6}
                        />
                        <line
                          x1="0" y1={pos} x2="120" y2={pos}
                          stroke={settings.gridLineColor || '#3b82f6'}
                          strokeWidth={settings.gridLineWidth || 1}
                          strokeOpacity={settings.gridLineOpacity || 0.6}
                        />
                      </g>
                    ))}
                    {/* Labels */}
                    {settings.showGridLabels && (
                      <>
                        <text x="2" y="10" fill={settings.gridLineColor || '#3b82f6'} fontSize="8" opacity={settings.gridLineOpacity || 0.6}>33U</text>
                        <text x="42" y="10" fill={settings.gridLineColor || '#3b82f6'} fontSize="8" opacity={settings.gridLineOpacity || 0.6}>NV</text>
                      </>
                    )}
                  </svg>
                </div>
              </>
            )}
          </div>
        )

      case 'navigation':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Navigationslinie vom Ballon zum aktiven Ziel
            </div>

            {/* Navigationslinie aktivieren */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.navLineEnabled !== false ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer', marginBottom: '16px',
              border: settings.navLineEnabled !== false ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.navLineEnabled !== false}
                onChange={e => updateLocalSettings({ navLineEnabled: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Navigationslinie anzeigen</span>
            </label>

            {settings.navLineEnabled !== false && (
              <>
                {/* Linienfarbe */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Linienfarbe</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{
                      width: '50px',
                      height: '50px',
                      borderRadius: '50%',
                      background: settings.navLineColor || '#22c55e',
                      border: '3px solid rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      <input
                        type="color"
                        value={settings.navLineColor || '#22c55e'}
                        onChange={e => updateLocalSettings({ navLineColor: e.target.value })}
                        style={{
                          position: 'absolute',
                          width: '200%',
                          height: '200%',
                          top: '-50%',
                          left: '-50%',
                          cursor: 'pointer',
                          opacity: 0
                        }}
                      />
                    </label>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Individuell wählbar</div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{(settings.navLineColor || '#22c55e').toUpperCase()}</div>
                    </div>
                  </div>
                </div>

                {/* Linienbreite */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                    Linienbreite: {settings.navLineWidth || 5}px
                  </div>
                  <input type="range" min="1" max="10" step="1" value={settings.navLineWidth || 5}
                    onChange={e => updateLocalSettings({ navLineWidth: parseInt(e.target.value) })}
                    style={{ width: '100%', cursor: 'pointer' }} />
                </div>

                {/* Kurs-Anzeige */}
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                  background: settings.navLineShowCourse ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
                  border: settings.navLineShowCourse ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
                }}>
                  <input type="checkbox" checked={settings.navLineShowCourse || false}
                    onChange={e => updateLocalSettings({ navLineShowCourse: e.target.checked })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span style={{ fontSize: '12px', color: 'white' }}>Kurs entlang der Linie anzeigen</span>
                </label>

                {settings.navLineShowCourse && (
                  <div style={{ marginBottom: '16px', marginLeft: '22px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                      Ausblenden ab Entfernung: {settings.navLineCourseHideDistance === 0 ? 'Nie' : `${settings.navLineCourseHideDistance || 0}m`}
                    </div>
                    <input type="range" min="0" max="2000" step="100" value={settings.navLineCourseHideDistance || 0}
                      onChange={e => updateLocalSettings({ navLineCourseHideDistance: parseInt(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>
                )}

                {/* Vorschau */}
                <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '16px' }}>
                  <svg width="180" height="40" style={{ overflow: 'visible' }}>
                    <line x1="10" y1="20" x2="170" y2="20" stroke={settings.navLineColor || '#22c55e'} strokeWidth={settings.navLineWidth || 5} strokeLinecap="round" />
                    {settings.navLineShowCourse && (
                      <g>
                        <rect x="75" y="6" width="30" height="18" rx="4" fill={settings.navLineColor || '#22c55e'} />
                        <text x="90" y="18" fill="white" fontSize="9" fontWeight="bold" textAnchor="middle">045°</text>
                      </g>
                    )}
                    <circle cx="10" cy="20" r="6" fill={settings.balloonMarkerColor || '#ef4444'} stroke="white" strokeWidth="2" />
                    <circle cx="170" cy="20" r="6" fill="#3b82f6" stroke="white" strokeWidth="2" />
                  </svg>
                </div>
              </>
            )}
          </div>
        )

      case 'taskrings':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Konzentrische Ringe um Task-Ziele für Distanzreferenz
            </div>

            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.showTaskRings !== false ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer', marginBottom: '16px',
              border: settings.showTaskRings !== false ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.showTaskRings !== false}
                onChange={e => updateLocalSettings({ showTaskRings: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Task Rings anzeigen</span>
            </label>

            {settings.showTaskRings !== false && (
              <>
                {/* Ring Farben */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Ring Farben (4 Ringe)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                    {(settings.ringColors || ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e']).map((color, idx) => (
                      <div key={idx}>
                        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textAlign: 'center' }}>{idx + 1}</div>
                        <input type="color" value={color}
                          onChange={e => {
                            const colors = [...(settings.ringColors || ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'])]
                            colors[idx] = e.target.value
                            updateLocalSettings({ ringColors: colors })
                          }}
                          style={{ width: '100%', height: '32px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Linienbreite */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                    Linienbreite: {settings.ringLineWidth || 2}px
                  </div>
                  <input type="range" min="1" max="5" step="1" value={settings.ringLineWidth || 2}
                    onChange={e => updateLocalSettings({ ringLineWidth: parseInt(e.target.value) })}
                    style={{ width: '100%', cursor: 'pointer' }} />
                </div>

                {/* Gestrichelt */}
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                  background: settings.ringDashed !== false ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '8px', cursor: 'pointer',
                  border: settings.ringDashed !== false ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
                }}>
                  <input type="checkbox" checked={settings.ringDashed !== false}
                    onChange={e => updateLocalSettings({ ringDashed: e.target.checked })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span style={{ fontSize: '12px', color: 'white' }}>Gestrichelte Linien</span>
                </label>

                {/* Vorschau */}
                <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '16px' }}>
                  <svg width="120" height="120" style={{ overflow: 'visible' }}>
                    {(settings.ringColors || ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e']).map((color, idx) => (
                      <circle key={idx} cx="60" cy="60" r={50 - idx * 12} fill="none" stroke={color}
                        strokeWidth={settings.ringLineWidth || 2}
                        strokeDasharray={settings.ringDashed !== false ? '4,4' : undefined} />
                    ))}
                    <circle cx="60" cy="60" r="4" fill="#3b82f6" />
                  </svg>
                </div>
              </>
            )}
          </div>
        )

      case 'kurslinien':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              HDG Kurslinien für 3 individuelle Kurse auf der Karte
            </div>

            {/* HDG Kurslinien Farben */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Linienfarben (3 Linien)</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[0, 1, 2].map(idx => (
                  <div key={idx} style={{ flex: 1 }}>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textAlign: 'center' }}>Linie {idx + 1}</div>
                    <input type="color" value={(settings.hdgCourseLineColors || ['#f59e0b', '#3b82f6', '#22c55e'])[idx]}
                      onChange={e => {
                        const colors = [...(settings.hdgCourseLineColors || ['#f59e0b', '#3b82f6', '#22c55e'])]
                        colors[idx] = e.target.value
                        updateLocalSettings({ hdgCourseLineColors: colors })
                      }}
                      style={{ width: '100%', height: '36px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Linienbreite */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Linienbreite: {settings.hdgCourseLineWidth || 3}px
              </div>
              <input type="range" min="1" max="8" step="1" value={settings.hdgCourseLineWidth || 3}
                onChange={e => updateLocalSettings({ hdgCourseLineWidth: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Linienlänge */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Linienlänge: {(settings.hdgCourseLineLength || 10000) / 1000}km
              </div>
              <input type="range" min="1000" max="50000" step="1000" value={settings.hdgCourseLineLength || 10000}
                onChange={e => updateLocalSettings({ hdgCourseLineLength: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Kurs-Anzeige Einstellungen */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px', fontWeight: 600 }}>Kurs-Badge</div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                  Schriftgröße: {settings.courseDisplaySize || 11}px
                </div>
                <input type="range" min="8" max="16" step="1" value={settings.courseDisplaySize || 11}
                  onChange={e => updateLocalSettings({ courseDisplaySize: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                background: settings.courseDisplayBold !== false ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
                border: settings.courseDisplayBold !== false ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
              }}>
                <input type="checkbox" checked={settings.courseDisplayBold !== false}
                  onChange={e => updateLocalSettings({ courseDisplayBold: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <span style={{ fontSize: '12px', color: 'white' }}>Fett</span>
              </label>

              <div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Textfarbe</div>
                <input type="color" value={settings.courseDisplayTextColor || '#ffffff'}
                  onChange={e => updateLocalSettings({ courseDisplayTextColor: e.target.value })}
                  style={{ width: '100%', height: '36px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
              </div>
            </div>

            {/* Vorschau */}
            <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
              {(settings.hdgCourseLineColors || ['#f59e0b', '#3b82f6', '#22c55e']).map((color, idx) => (
                <div key={idx} style={{
                  background: color, color: settings.courseDisplayTextColor || '#ffffff',
                  padding: '4px 8px', borderRadius: '4px',
                  fontSize: `${settings.courseDisplaySize || 11}px`,
                  fontWeight: settings.courseDisplayBold !== false ? 700 : 400
                }}>
                  {90 + idx * 30}°
                </div>
              ))}
            </div>
          </div>
        )

      case 'windlinien':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              3 individuelle Wind-Linien für verschiedene Höhenschichten
            </div>

            {/* Wind-Linien Farben */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Linienfarben (3 Linien)</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[0, 1, 2].map(idx => (
                  <div key={idx} style={{ flex: 1 }}>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textAlign: 'center' }}>Linie {idx + 1}</div>
                    <input type="color" value={(settings.windLineColors || ['#00bcd4', '#ff6b6b', '#ffd93d'])[idx]}
                      onChange={e => {
                        const colors = [...(settings.windLineColors || ['#00bcd4', '#ff6b6b', '#ffd93d'])] as [string, string, string]
                        colors[idx] = e.target.value
                        updateLocalSettings({ windLineColors: colors })
                      }}
                      style={{ width: '100%', height: '36px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Linienbreite */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Linienbreite: {settings.windLineWidth || 3}px
              </div>
              <input type="range" min="1" max="8" step="1" value={settings.windLineWidth || 3}
                onChange={e => updateLocalSettings({ windLineWidth: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Vorschau */}
            <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginTop: '16px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', textAlign: 'center' }}>Vorschau</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                {(settings.windLineColors || ['#00bcd4', '#ff6b6b', '#ffd93d']).map((color, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="120" height="4">
                      <line x1="0" y1="2" x2="120" y2="2" stroke={color} strokeWidth={settings.windLineWidth || 3} />
                    </svg>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{['Niedrig', 'Mittel', 'Hoch'][idx]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      case 'ballon':
        // SVG-Pfade für verschiedene Icon-Stile
        const markerIcons: { key: string; label: string; path: string }[] = [
          { key: 'arrow', label: 'Pfeil', path: 'M12 2L6 14h12L12 2z' },
          { key: 'triangle', label: 'Dreieck', path: 'M12 3L3 21h18L12 3z' },
          { key: 'dart', label: 'Dart', path: 'M12 2L8 12l4 2 4-2L12 2zM12 14v8' },
          { key: 'pointer', label: 'Zeiger', path: 'M12 2L8 10h8L12 2zM12 10v12' },
          { key: 'diamond', label: 'Diamant', path: 'M12 2L4 12l8 10 8-10L12 2z' },
          { key: 'chevron', label: 'Chevron', path: 'M12 4L4 12l8 8 8-8L12 4zM12 8l-4 4 4 4 4-4-4-4z' },
          { key: 'aircraft', label: 'Flugzeug', path: 'M12 2L10 8H6l-2 2h6v8l-2 2h4l2-2h4l-2-2H10v-8h6l-2-2h-4L12 2z' },
          { key: 'circle', label: 'Kreis', path: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 2v4M12 18v4' }
        ]

        return (
          <div>
            {/* Icon Stil - Visuell */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '12px' }}>Icon Stil</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {markerIcons.map(({ key, label, path }) => (
                  <button
                    key={key}
                    onClick={() => updateLocalSettings({ balloonMarkerIcon: key as any })}
                    style={{
                      padding: '12px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      background: (settings.balloonMarkerIcon || 'arrow') === key ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.05)',
                      border: (settings.balloonMarkerIcon || 'arrow') === key ? '2px solid rgba(59,130,246,0.8)' : '2px solid transparent',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: (settings.balloonMarkerIcon || 'arrow') === key ? '0 4px 12px rgba(59,130,246,0.3)' : 'none'
                    }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" style={{ transform: 'rotate(0deg)' }}>
                      <path d={path} fill={settings.balloonMarkerColor || '#ef4444'} stroke="white" strokeWidth="1" />
                    </svg>
                    <span style={{ fontSize: '9px', color: (settings.balloonMarkerIcon || 'arrow') === key ? '#fff' : 'rgba(255,255,255,0.5)' }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Größe */}
            <div style={{ marginBottom: '16px', padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Größe</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { key: 'small', label: 'Klein' },
                  { key: 'medium', label: 'Mittel' },
                  { key: 'large', label: 'Groß' }
                ].map(({ key, label }) => (
                  <button key={key} onClick={() => updateLocalSettings({ balloonMarkerSize: key as any })} style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: '20px',
                    background: (settings.balloonMarkerSize || 'medium') === key ? 'rgba(59,130,246,1)' : 'rgba(255,255,255,0.08)',
                    color: (settings.balloonMarkerSize || 'medium') === key ? '#fff' : 'rgba(255,255,255,0.5)',
                    transition: 'all 0.2s ease',
                    boxShadow: (settings.balloonMarkerSize || 'medium') === key ? '0 2px 8px rgba(59,130,246,0.4)' : 'none'
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Farbe */}
            <div style={{ marginBottom: '16px', padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Marker Farbe</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  background: settings.balloonMarkerColor || '#ef4444',
                  border: '3px solid rgba(255,255,255,0.3)',
                  cursor: 'pointer',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <input
                    type="color"
                    value={settings.balloonMarkerColor || '#ef4444'}
                    onChange={e => updateLocalSettings({ balloonMarkerColor: e.target.value })}
                    style={{
                      position: 'absolute',
                      width: '200%',
                      height: '200%',
                      top: '-50%',
                      left: '-50%',
                      cursor: 'pointer',
                      opacity: 0
                    }}
                  />
                </label>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Individuell wählbar</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{(settings.balloonMarkerColor || '#ef4444').toUpperCase()}</div>
                </div>
              </div>
            </div>

            {/* Heading Linie */}
            <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px', fontWeight: 600 }}>Heading Linie</div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)'
              }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Anzeigen</span>
                <button
                  onClick={() => updateLocalSettings({ balloonHeadingLine: !settings.balloonHeadingLine })}
                  style={{
                    padding: '7px 20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: '20px',
                    background: settings.balloonHeadingLine ? 'rgba(34,197,94,1)' : 'rgba(255,255,255,0.08)',
                    color: settings.balloonHeadingLine ? '#fff' : 'rgba(255,255,255,0.5)',
                    transition: 'all 0.2s ease',
                    boxShadow: settings.balloonHeadingLine ? '0 2px 8px rgba(34,197,94,0.4)' : 'none'
                  }}
                >
                  {settings.balloonHeadingLine ? 'An' : 'Aus'}
                </button>
              </div>

              {settings.balloonHeadingLine && (
                <>
                  <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Linienfarbe</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <label style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: settings.balloonHeadingLineColor || '#ffffff',
                        border: '2px solid rgba(255,255,255,0.3)',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        position: 'relative',
                        overflow: 'hidden'
                      }}>
                        <input
                          type="color"
                          value={settings.balloonHeadingLineColor || '#ffffff'}
                          onChange={e => updateLocalSettings({ balloonHeadingLineColor: e.target.value })}
                          style={{
                            position: 'absolute',
                            width: '200%',
                            height: '200%',
                            top: '-50%',
                            left: '-50%',
                            cursor: 'pointer',
                            opacity: 0
                          }}
                        />
                      </label>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{(settings.balloonHeadingLineColor || '#ffffff').toUpperCase()}</div>
                    </div>
                  </div>

                  <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Länge</span>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#fff',
                        background: 'rgba(59,130,246,0.3)',
                        padding: '4px 12px',
                        borderRadius: '12px'
                      }}>{(settings.balloonHeadingLineLength || 100) >= 1000 ? `${((settings.balloonHeadingLineLength || 100) / 1000).toFixed(1)} km` : `${settings.balloonHeadingLineLength || 100} m`}</span>
                    </div>
                    <input type="range" min="10" max="5000" step="10" value={settings.balloonHeadingLineLength || 100}
                      onChange={e => updateLocalSettings({ balloonHeadingLineLength: parseInt(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>

                  <div style={{ padding: '14px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>Breite</span>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#fff',
                        background: 'rgba(59,130,246,0.3)',
                        padding: '4px 12px',
                        borderRadius: '12px'
                      }}>{settings.balloonHeadingLineWidth || 2} px</span>
                    </div>
                    <input type="range" min="1" max="8" step="1" value={settings.balloonHeadingLineWidth || 2}
                      onChange={e => updateLocalSettings({ balloonHeadingLineWidth: parseInt(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>
                </>
              )}
            </div>
          </div>
        )

      case 'farben':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Farben für Task Marker und Farbpalette beim Erstellen von Tasks
            </div>

            {/* Task Marker Farbpalette */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '8px', fontWeight: 600 }}>Task Marker Palette (8 Farben)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {(settings.taskMarkerColors || ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#64748b']).map((color, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textAlign: 'center' }}>{idx + 1}</div>
                    <input type="color" value={color}
                      onChange={e => {
                        const colors = [...(settings.taskMarkerColors || ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#64748b'])]
                        colors[idx] = e.target.value
                        updateLocalSettings({ taskMarkerColors: colors })
                      }}
                      style={{ width: '100%', height: '36px', borderRadius: '6px', border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Hinweis */}
            <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.5' }}>
                <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Weitere Farbeinstellungen:</strong><br/>
                • Zielkreuz Icon → Task Icon
              </div>
            </div>
          </div>
        )

      case 'sperrgebiete':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Darstellung von Sperrgebieten (Prohibited Zones) auf der Karte
            </div>

            {/* PZ Kreis Farbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>PZ Kreisfarbe</div>
              <input type="color" value={settings.pzCircleColor || '#ef4444'}
                onChange={e => updateLocalSettings({ pzCircleColor: e.target.value })}
                style={{ width: '100%', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer' }} />
            </div>

            {/* Füll-Deckkraft */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Füll-Deckkraft: {Math.round((settings.pzCircleOpacity || 0.15) * 100)}%
              </div>
              <input type="range" min="0" max="1" step="0.05" value={settings.pzCircleOpacity || 0.15}
                onChange={e => updateLocalSettings({ pzCircleOpacity: parseFloat(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Gestrichelt */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.pzCircleDashed !== false ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer', marginBottom: '16px',
              border: settings.pzCircleDashed !== false ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.pzCircleDashed !== false}
                onChange={e => updateLocalSettings({ pzCircleDashed: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Gestrichelte Kreise</span>
            </label>

            {/* Label Einstellungen */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px', fontWeight: 600 }}>Label Einstellungen</div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                  Schriftgröße: {settings.pzLabelSize || 11}px
                </div>
                <input type="range" min="8" max="16" step="1" value={settings.pzLabelSize || 11}
                  onChange={e => updateLocalSettings({ pzLabelSize: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>Textfarbe</div>
                  <input type="color" value={settings.pzLabelColor || '#ffffff'}
                    onChange={e => updateLocalSettings({ pzLabelColor: e.target.value })}
                    style={{ width: '100%', height: '32px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>Hintergrund</div>
                  <input type="color" value={settings.pzLabelBackground?.replace('rgba', '').includes('239') ? '#ef4444' : '#ef4444'}
                    onChange={e => updateLocalSettings({ pzLabelBackground: e.target.value })}
                    style={{ width: '100%', height: '32px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
                </div>
              </div>
            </div>

            {/* Höheneinheit */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Höhenanzeige</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['feet', 'meters'] as const).map(unit => (
                  <button key={unit} onClick={() => updateLocalSettings({ pzAltitudeUnit: unit })} style={{
                    flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600,
                    background: (settings.pzAltitudeUnit || 'feet') === unit ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                    color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}>
                    {unit === 'feet' ? 'Fuß (ft)' : 'Meter (m)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Vorschau */}
            <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
              <svg width="80" height="80" style={{ overflow: 'visible' }}>
                <circle cx="40" cy="40" r="35" fill={`${settings.pzCircleColor || '#ef4444'}${Math.round((settings.pzCircleOpacity || 0.15) * 255).toString(16).padStart(2, '0')}`}
                  stroke={settings.pzCircleColor || '#ef4444'} strokeWidth="2"
                  strokeDasharray={settings.pzCircleDashed !== false ? '4,4' : undefined} />
              </svg>
              <div style={{
                background: settings.pzLabelBackground || 'rgba(239, 68, 68, 0.95)',
                color: settings.pzLabelColor || '#ffffff',
                padding: '4px 8px', borderRadius: '4px',
                fontSize: `${settings.pzLabelSize || 11}px`, fontWeight: 600
              }}>
                PZ 1500ft
              </div>
            </div>
          </div>
        )

      case 'uigroesse':
        const uiStepperRow = (label: string, value: number, min: number, max: number, step: number, displayFn: (v: number) => string, onChange: (val: number) => void) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))} style={{
                width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: value <= min ? 'default' : 'pointer',
                background: value <= min ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.1)', color: value <= min ? 'rgba(255,255,255,0.2)' : '#fff',
                fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>−</button>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6', minWidth: '50px', textAlign: 'center' }}>
                {displayFn(value)}
              </span>
              <button onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))} style={{
                width: '32px', height: '32px', borderRadius: '8px', border: 'none', cursor: value >= max ? 'default' : 'pointer',
                background: value >= max ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.1)', color: value >= max ? 'rgba(255,255,255,0.2)' : '#fff',
                fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>+</button>
            </div>
          </div>
        )
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '12px' }}>
              Für kleine Bildschirme oder bessere Lesbarkeit
            </div>

            {/* Header Höhe */}
            {uiStepperRow('Header Höhe', settings.headerHeight || 60, 40, 80, 5, v => `${v}px`, v => updateLocalSettings({ headerHeight: v }))}

            {/* Panel Skalierungen */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '8px', fontWeight: 600 }}>Panel Skalierung</div>

              {[
                { key: 'navPanelScale', label: 'Navigation' },
                { key: 'briefingPanelScale', label: 'Briefing' },
                { key: 'windPanelScale', label: 'Wind' },
                { key: 'drawPanelScale', label: 'Zeichnen' },
                { key: 'taskEditPanelScale', label: 'Task Edit' },
                { key: 'teamPanelScale', label: 'Team' },
                { key: 'notificationScale', label: 'Benachrichtigungen' },
                { key: 'markerPanelScale', label: 'Marker Drop' },
                { key: 'climbPanelScale', label: 'PDG/FON' },
                { key: 'landingPanelScale', label: 'Landeprognose' },
                { key: 'lrnPanelScale', label: 'Land Run' },
                { key: 'aptPanelScale', label: 'Altitude Profile' },
                { key: 'angPanelScale', label: 'ANG' },
                { key: 'windRoseScale', label: 'Windrose' }
              ].map(({ key, label }) => (
                uiStepperRow(label, (settings as any)[key] || 1, 0.6, 1.5, 0.1, v => `${Math.round(v * 100)}%`, v => updateLocalSettings({ [key]: v }))
              ))}
            </div>
          </div>
        )

      case 'taskicon':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Einstellungen für das Ziel-Kreuz Icon auf der Karte
            </div>

            {/* Kreuz Farbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Kreuz Farbe</div>
              <input type="color" value={settings.crossIconColor || '#000000'}
                onChange={e => updateLocalSettings({ crossIconColor: e.target.value })}
                style={{ width: '100%', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer' }} />
            </div>

            {/* Kreuz Größe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Größe: {settings.crossIconSize || 24}px
              </div>
              <input type="range" min="12" max="48" step="2" value={settings.crossIconSize || 24}
                onChange={e => updateLocalSettings({ crossIconSize: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Strichstärke */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Strichstärke: {settings.crossIconStrokeWidth || 3}px
              </div>
              <input type="range" min="1" max="6" step="1" value={settings.crossIconStrokeWidth || 3}
                onChange={e => updateLocalSettings({ crossIconStrokeWidth: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Vorschau */}
            <div style={{ padding: '24px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={settings.crossIconSize || 24} height={settings.crossIconSize || 24} viewBox="0 0 24 24">
                <line x1="12" y1="2" x2="12" y2="22" stroke={settings.crossIconColor || '#000000'} strokeWidth={settings.crossIconStrokeWidth || 3} strokeLinecap="round" />
                <line x1="2" y1="12" x2="22" y2="12" stroke={settings.crossIconColor || '#000000'} strokeWidth={settings.crossIconStrokeWidth || 3} strokeLinecap="round" />
              </svg>
            </div>
          </div>
        )

      case 'tasklabel':
        return (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Präfix</div>
              <input type="text" value={settings.taskLabelPrefix ?? 'Task'}
                onChange={e => updateLocalSettings({ taskLabelPrefix: e.target.value })}
                placeholder="z.B. Task, T, ..."
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '12px', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Schriftgröße: {settings.taskLabelFontSize || 14}px
              </div>
              <input type="range" min="10" max="24" step="1" value={settings.taskLabelFontSize || 14}
                onChange={e => updateLocalSettings({ taskLabelFontSize: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Padding: {settings.taskLabelPadding || 6}px
              </div>
              <input type="range" min="2" max="16" step="1" value={settings.taskLabelPadding || 6}
                onChange={e => updateLocalSettings({ taskLabelPadding: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Logger Badge LM */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px', fontWeight: 600 }}>Logger Marker (LM)</div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>LM Präfix</div>
                <input type="text" value={settings.loggerLabelPrefix ?? 'LM'}
                  onChange={e => updateLocalSettings({ loggerLabelPrefix: e.target.value })}
                  placeholder="z.B. LM, L, ..."
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '12px', boxSizing: 'border-box' }} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>LM Badge Farbe</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="color" value={settings.loggerBadgeColor || '#10b981'}
                    onChange={e => updateLocalSettings({ loggerBadgeColor: e.target.value })}
                    style={{ width: '40px', height: '40px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', background: 'none', padding: 0 }} />
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>{settings.loggerBadgeColor || '#10b981'}</span>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>LM Badge Größe</span>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{settings.loggerBadgeFontSize || 11}px</span>
                </div>
                <input type="range" min="8" max="24" step="1" value={settings.loggerBadgeFontSize || 11}
                  onChange={e => updateLocalSettings({ loggerBadgeFontSize: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>
            </div>

            {/* Logger Goal (LG) */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px', fontWeight: 600 }}>Logger Goal (LG)</div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>LG Präfix</div>
                <input type="text" value={settings.loggerGoalLabelPrefix ?? 'LG'}
                  onChange={e => updateLocalSettings({ loggerGoalLabelPrefix: e.target.value })}
                  placeholder="z.B. LG, G, ..."
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '12px', boxSizing: 'border-box' }} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>LG Badge Farbe</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="color" value={settings.loggerGoalBadgeColor || '#f59e0b'}
                    onChange={e => updateLocalSettings({ loggerGoalBadgeColor: e.target.value })}
                    style={{ width: '40px', height: '40px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', background: 'none', padding: 0 }} />
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>{settings.loggerGoalBadgeColor || '#f59e0b'}</span>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>LG Badge Größe</span>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{settings.loggerGoalBadgeFontSize || 11}px</span>
                </div>
                <input type="range" min="8" max="24" step="1" value={settings.loggerGoalBadgeFontSize || 11}
                  onChange={e => updateLocalSettings({ loggerGoalBadgeFontSize: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>
            </div>

            {/* Vorschau */}
            <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
              <div style={{
                background: '#3b82f6', color: 'white',
                padding: `${settings.taskLabelPadding || 6}px ${(settings.taskLabelPadding || 6) * 2}px`,
                borderRadius: '8px', fontSize: `${settings.taskLabelFontSize || 14}px`, fontWeight: 700, border: '2px solid white'
              }}>
                {(settings.taskLabelPrefix ?? 'Task') ? `${settings.taskLabelPrefix ?? 'Task'} 12: ` : ''}JDG
              </div>
              <div style={{
                background: settings.loggerBadgeColor || '#10b981', color: 'white',
                padding: `${Math.max(2, (settings.loggerBadgeFontSize || 11) * 0.35)}px ${Math.max(4, (settings.loggerBadgeFontSize || 11) * 0.7)}px`,
                borderRadius: '999px', fontSize: `${settings.loggerBadgeFontSize || 11}px`, fontWeight: 700, border: '2px solid white'
              }}>
                {settings.loggerLabelPrefix ?? 'LM'}1
              </div>
              <div style={{
                background: settings.loggerGoalBadgeColor || '#f59e0b', color: 'white',
                padding: `${Math.max(2, (settings.loggerGoalBadgeFontSize || 11) * 0.35)}px ${Math.max(4, (settings.loggerGoalBadgeFontSize || 11) * 0.7)}px`,
                borderRadius: '999px', fontSize: `${settings.loggerGoalBadgeFontSize || 11}px`, fontWeight: 700, border: '2px solid white'
              }}>
                {settings.loggerGoalLabelPrefix ?? 'LG'}1
              </div>
            </div>
          </div>
        )

      case 'aufzeichnung':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Einstellungen für die Aufzeichnung von Trackpunkten
            </div>

            {/* Recording Mode */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Aufzeichnungsmodus</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {['time', 'distance'].map(mode => (
                  <button key={mode} onClick={() => updateLocalSettings({ trackRecordingMode: mode as 'time' | 'distance' })} style={{
                    flex: 1, padding: '12px', fontSize: '11px', fontWeight: 600,
                    background: settings.trackRecordingMode === mode ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                    color: 'white', border: settings.trackRecordingMode === mode ? '2px solid #60a5fa' : '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px', cursor: 'pointer'
                  }}>
                    {mode === 'time' ? 'Zeit' : 'Distanz'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '8px', fontStyle: 'italic' }}>
                Hinweis: Trackpunkte werden aus Performance-Gründen erst nach Beenden der Aufzeichnung angezeigt.
              </div>
            </div>

            {/* Time/Distance Interval */}
            {settings.trackRecordingMode === 'time' ? (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                  Zeitintervall: {settings.trackRecordingTimeInterval || 5} Sekunden
                </div>
                <input type="range" min="1" max="60" step="1" value={settings.trackRecordingTimeInterval || 5}
                  onChange={e => updateLocalSettings({ trackRecordingTimeInterval: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>
            ) : (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                  Distanzintervall: {settings.trackRecordingDistanceInterval || 10} Meter
                </div>
                <input type="range" min="1" max="100" step="1" value={settings.trackRecordingDistanceInterval || 10}
                  onChange={e => updateLocalSettings({ trackRecordingDistanceInterval: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>
            )}

            {/* Track Line */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Track Linie</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>Farbe</div>
                  <input type="color" value={settings.trackLineColor || '#1a73e8'}
                    onChange={e => updateLocalSettings({ trackLineColor: e.target.value })}
                    style={{ width: '100%', height: '36px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} />
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>Dicke: {settings.trackLineWidth || 3}px</div>
                  <input type="range" min="1" max="10" step="1" value={settings.trackLineWidth || 3}
                    onChange={e => updateLocalSettings({ trackLineWidth: parseInt(e.target.value) })}
                    style={{ width: '100%', cursor: 'pointer', marginTop: '8px' }} />
                </div>
              </div>
            </div>

            {/* Track Point Markers */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.trackPointMarkers ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer',
              border: settings.trackPointMarkers ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.trackPointMarkers || false}
                onChange={e => updateLocalSettings({ trackPointMarkers: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Trackpunkte als Marker anzeigen</span>
            </label>

            {/* Preview */}
            <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '16px' }}>
              <svg width="200" height="40" style={{ overflow: 'visible' }}>
                <line x1="10" y1="20" x2="190" y2="20" stroke={settings.trackLineColor || '#1a73e8'} strokeWidth={settings.trackLineWidth || 3} strokeLinecap="round" />
                {settings.trackPointMarkers && (
                  <>
                    <circle cx="10" cy="20" r="4" fill={settings.trackLineColor || '#1a73e8'} stroke="white" strokeWidth="1.5" />
                    <circle cx="100" cy="20" r="4" fill={settings.trackLineColor || '#1a73e8'} stroke="white" strokeWidth="1.5" />
                    <circle cx="190" cy="20" r="4" fill={settings.trackLineColor || '#1a73e8'} stroke="white" strokeWidth="1.5" />
                  </>
                )}
              </svg>
            </div>
          </div>
        )

      case 'audio':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Audio-Einstellungen für Warnungen und Benachrichtigungen
            </div>

            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.audioAlerts ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
              border: settings.audioAlerts ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.audioAlerts || false}
                onChange={e => updateLocalSettings({ audioAlerts: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Audio-Benachrichtigungen</span>
            </label>

            {settings.audioAlerts && (<>
            {/* Variometer Audio Section */}
            <div style={{ marginBottom: '20px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: settings.variometerAudio ? '16px' : '0'
              }}>
                <input type="checkbox" checked={settings.variometerAudio || false}
                  onChange={e => updateLocalSettings({ variometerAudio: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={settings.variometerAudio ? '#22c55e' : 'rgba(255,255,255,0.5)'} strokeWidth="2">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                  </svg>
                  <span style={{ fontSize: '12px', color: 'white', fontWeight: 500 }}>Variometer Audio</span>
                </div>
              </label>

              {settings.variometerAudio && (
                <>
                  {/* Lautstärke */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Lautstärke: {Math.round((settings.variometerVolume ?? 0.5) * 100)}%
                    </div>
                    <input type="range" min="0.1" max="1" step="0.05" value={settings.variometerVolume ?? 0.5}
                      onChange={e => updateLocalSettings({ variometerVolume: parseFloat(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>

                  {/* Steigen Schwellwert */}
                  <div style={{ marginBottom: '14px', padding: '10px', background: 'rgba(34,197,94,0.1)', borderRadius: '6px', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                        <path d="M12 19V5M5 12l7-7 7 7"/>
                      </svg>
                      <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>Steigen</span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>
                      Ton ab: {(settings.variometerClimbThreshold ?? 0.3).toFixed(1)} m/s
                    </div>
                    <input type="range" min="0" max="10" step="0.1" value={settings.variometerClimbThreshold ?? 0.3}
                      onChange={e => updateLocalSettings({ variometerClimbThreshold: parseFloat(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                      <span>0</span>
                      <span>10 m/s</span>
                    </div>
                  </div>

                  {/* Sinken Schwellwert */}
                  <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                        <path d="M12 5v14M5 12l7 7 7-7"/>
                      </svg>
                      <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>Sinken</span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>
                      Ton ab: {(settings.variometerSinkThreshold ?? -1.5).toFixed(1)} m/s
                    </div>
                    <input type="range" min="-10" max="0" step="0.1" value={settings.variometerSinkThreshold ?? -1.5}
                      onChange={e => updateLocalSettings({ variometerSinkThreshold: parseFloat(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                      <span>-10</span>
                      <span>0 m/s</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Task Erinnerung */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Task Erinnerung</span>
              </div>

              {/* Erinnerungszeit */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Erinnerungszeit vor Task-Ende</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="number" min="1" max="60" value={settings.taskReminderValue || 5}
                    onChange={e => updateLocalSettings({ taskReminderValue: parseInt(e.target.value) || 5 })}
                    style={{ width: '70px', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#f59e0b', fontSize: '14px', fontWeight: 600, textAlign: 'center' }} />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {(['minutes', 'seconds'] as const).map(unit => (
                      <button key={unit} onClick={() => updateLocalSettings({ taskReminderUnit: unit })} style={{
                        padding: '8px 12px', fontSize: '11px', fontWeight: 600,
                        background: (settings.taskReminderUnit || 'minutes') === unit ? '#f59e0b' : 'rgba(255,255,255,0.1)',
                        color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                      }}>
                        {unit === 'minutes' ? 'Min' : 'Sek'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                background: settings.taskReminderSoundEnabled !== false ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
                border: settings.taskReminderSoundEnabled !== false ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent'
              }}>
                <input type="checkbox" checked={settings.taskReminderSoundEnabled !== false}
                  onChange={e => updateLocalSettings({ taskReminderSoundEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <span style={{ fontSize: '12px', color: 'white' }}>Sound bei Erinnerung</span>
              </label>

              {settings.taskReminderSoundEnabled !== false && (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                      Sound-Dauer: {settings.taskReminderSoundDuration || 2} Sek
                    </div>
                    <input type="range" min="1" max="10" step="1" value={settings.taskReminderSoundDuration || 2}
                      onChange={e => updateLocalSettings({ taskReminderSoundDuration: parseInt(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                      Lautstärke: {Math.round((settings.taskReminderSoundVolume || 0.5) * 100)}%
                    </div>
                    <input type="range" min="0.1" max="1" step="0.1" value={settings.taskReminderSoundVolume || 0.5}
                      onChange={e => updateLocalSettings({ taskReminderSoundVolume: parseFloat(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>
                </>
              )}
            </div>

            {/* PZ Warnung */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
                </svg>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>PZ Warnung</span>
              </div>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                background: settings.pzWarningEnabled !== false ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
                border: settings.pzWarningEnabled !== false ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent'
              }}>
                <input type="checkbox" checked={settings.pzWarningEnabled !== false}
                  onChange={e => updateLocalSettings({ pzWarningEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <span style={{ fontSize: '12px', color: 'white' }}>PZ Warnung aktivieren</span>
              </label>

              {settings.pzWarningEnabled !== false && (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                      Warnungsdistanz: {settings.pzWarningDistance || 500}m
                    </div>
                    <input type="range" min="100" max="2000" step="100" value={settings.pzWarningDistance || 500}
                      onChange={e => updateLocalSettings({ pzWarningDistance: parseInt(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                      Vorlauf-Warnung (Margin): {settings.pzWarningMargin ?? 500} ft
                    </div>
                    <input type="range" min="0" max="1000" step="10" value={settings.pzWarningMargin ?? 500}
                      onChange={e => updateLocalSettings({ pzWarningMargin: parseInt(e.target.value) })}
                      style={{ width: '100%', cursor: 'pointer' }} />
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                      Gelbe Warnung wenn du dich näherst, Rote Warnung im Sperrbereich
                    </div>
                  </div>

                  <label style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                    background: settings.pzWarningSoundEnabled !== false ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                    borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
                    border: settings.pzWarningSoundEnabled !== false ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent'
                  }}>
                    <input type="checkbox" checked={settings.pzWarningSoundEnabled !== false}
                      onChange={e => updateLocalSettings({ pzWarningSoundEnabled: e.target.checked })}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                    <span style={{ fontSize: '12px', color: 'white' }}>Warnungston abspielen</span>
                  </label>

                  {settings.pzWarningSoundEnabled !== false && (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Sound-Typ</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {(['alarm', 'beep'] as const).map(type => (
                            <button key={type} onClick={() => updateLocalSettings({ pzWarningSoundType: type })} style={{
                              flex: 1, padding: '8px', fontSize: '11px', fontWeight: 600,
                              background: (settings.pzWarningSoundType || 'alarm') === type ? '#ef4444' : 'rgba(255,255,255,0.1)',
                              color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                            }}>
                              {type === 'alarm' ? 'Alarm' : 'Beep'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                          Sound-Dauer: {settings.pzWarningSoundDuration || 3} Sek
                        </div>
                        <input type="range" min="1" max="10" step="1" value={settings.pzWarningSoundDuration || 3}
                          onChange={e => updateLocalSettings({ pzWarningSoundDuration: parseInt(e.target.value) })}
                          style={{ width: '100%', cursor: 'pointer' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                          Lautstärke: {Math.round((settings.pzWarningSoundVolume || 0.7) * 100)}%
                        </div>
                        <input type="range" min="0.1" max="1" step="0.1" value={settings.pzWarningSoundVolume || 0.7}
                          onChange={e => updateLocalSettings({ pzWarningSoundVolume: parseFloat(e.target.value) })}
                          style={{ width: '100%', cursor: 'pointer' }} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Marker Drop Signal */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v4l3 3"/>
                </svg>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Marker Drop Signal</span>
              </div>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                background: settings.dropSignalSoundEnabled !== false ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.05)',
                borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
                border: settings.dropSignalSoundEnabled !== false ? '1px solid rgba(249,115,22,0.3)' : '1px solid transparent'
              }}>
                <input type="checkbox" checked={settings.dropSignalSoundEnabled !== false}
                  onChange={e => updateLocalSettings({ dropSignalSoundEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <span style={{ fontSize: '12px', color: 'white' }}>DROP-Signal Sound aktivieren</span>
              </label>

              {settings.dropSignalSoundEnabled !== false && (
                <div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                    Lautstärke: {Math.round((settings.dropSignalSoundVolume ?? 0.8) * 100)}%
                  </div>
                  <input type="range" min="0.1" max="1" step="0.1" value={settings.dropSignalSoundVolume ?? 0.8}
                    onChange={e => updateLocalSettings({ dropSignalSoundVolume: parseFloat(e.target.value) })}
                    style={{ width: '100%', cursor: 'pointer' }} />
                </div>
              )}
            </div>

            </>)}
          </div>
        )

      case 'zeichnen':
        return (
          <div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Farben und Einstellungen für Zeichnungen auf der Karte
            </div>

            {/* Linienfarbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Linienfarbe</div>
              <input type="color" value={settings.drawingLineColor || '#3b82f6'}
                onChange={e => updateLocalSettings({ drawingLineColor: e.target.value })}
                style={{ width: '100%', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer' }} />
            </div>

            {/* Füllfarbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Füllfarbe</div>
              <input type="color" value={settings.drawingFillColor || '#3b82f6'}
                onChange={e => updateLocalSettings({ drawingFillColor: e.target.value })}
                style={{ width: '100%', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer' }} />
            </div>

            {/* Mess-Farbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Messungs-Farbe</div>
              <input type="color" value={settings.measureColor || '#22c55e'}
                onChange={e => updateLocalSettings({ measureColor: e.target.value })}
                style={{ width: '100%', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer' }} />
            </div>

            {/* Linienbreite */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Linienbreite: {settings.lineWidth || 3}px
              </div>
              <input type="range" min="1" max="10" step="1" value={settings.lineWidth || 3}
                onChange={e => updateLocalSettings({ lineWidth: parseInt(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            {/* Kreis Radius */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Standard Kreisradius (m)</div>
              <input type="number" value={settings.circleRadius ?? 500}
                onChange={e => updateLocalSettings({ circleRadius: parseInt(e.target.value) || 500 })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#3b82f6', fontSize: '12px', fontWeight: 600, boxSizing: 'border-box' }} />
            </div>

            {/* Grid Snapping */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.circleGridSnapping ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer', marginBottom: '12px',
              border: settings.circleGridSnapping ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.circleGridSnapping || false}
                onChange={e => updateLocalSettings({ circleGridSnapping: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Kreis Grid-Snapping</span>
            </label>

            <label style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
              background: settings.lineGridSnapping ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px', cursor: 'pointer',
              border: settings.lineGridSnapping ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent'
            }}>
              <input type="checkbox" checked={settings.lineGridSnapping || false}
                onChange={e => updateLocalSettings({ lineGridSnapping: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: 'white' }}>Linien Grid-Snapping</span>
            </label>

            {/* Vorschau */}
            <div style={{ padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
              <svg width="60" height="60" style={{ overflow: 'visible' }}>
                <circle cx="30" cy="30" r="25" fill={`${settings.drawingFillColor || '#3b82f6'}40`} stroke={settings.drawingLineColor || '#3b82f6'} strokeWidth={settings.lineWidth || 3} />
              </svg>
              <svg width="60" height="40" style={{ overflow: 'visible' }}>
                <line x1="5" y1="20" x2="55" y2="20" stroke={settings.measureColor || '#22c55e'} strokeWidth="2" />
                <circle cx="5" cy="20" r="3" fill={settings.measureColor || '#22c55e'} />
                <circle cx="55" cy="20" r="3" fill={settings.measureColor || '#22c55e'} />
              </svg>
            </div>
          </div>
        )

      default:
        return <div style={{ color: 'rgba(255,255,255,0.5)' }}>Wähle eine Kategorie</div>
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.3)',
      backdropFilter: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      transition: 'background 0.3s ease'
    }} onClick={handleClose}>

      {/* Bestätigungs-Dialog */}
      {showConfirmDialog && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001
        }} onClick={e => e.stopPropagation()}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px',
            border: '1px solid rgba(245,158,11,0.3)', padding: '24px', width: '340px', textAlign: 'center'
          }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>Änderungen speichern?</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px' }}>
              Du hast Änderungen vorgenommen. Möchtest du diese speichern?
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleDiscardAndClose} style={{ flex: 1, padding: '10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Verwerfen</button>
              <button onClick={() => setShowConfirmDialog(false)} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: 'rgba(255,255,255,0.8)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={handleSaveAndClose} style={{ flex: 1, padding: '10px', background: '#22c55e', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '16px', width: '700px', maxWidth: '95vw', height: '650px', maxHeight: '90vh',
        boxShadow: '0 25px 80px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>

        {/* ═══════════════════════════════════════════ */}
        {/* SIDEBAR */}
        {/* ═══════════════════════════════════════════ */}
        <div style={{
          width: '220px', borderRight: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)'
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b' }}>Einstellungen</div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                width: '100%', padding: '10px 12px', marginBottom: '2px', borderRadius: '8px', cursor: 'pointer',
                background: activeTab === tab.key ? 'rgba(245,158,11,0.15)' : 'transparent',
                border: activeTab === tab.key ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={activeTab === tab.key ? '#f59e0b' : 'rgba(255,255,255,0.5)'} strokeWidth="2">
                  <path d={tab.icon} />
                </svg>
                <span style={{ fontSize: '12px', fontWeight: activeTab === tab.key ? 600 : 400, color: activeTab === tab.key ? '#f59e0b' : 'rgba(255,255,255,0.7)' }}>
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* MAIN CONTENT */}
        {/* ═══════════════════════════════════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(245, 158, 11, 0.05)'
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
              {TABS.find(t => t.key === activeTab)?.label}
            </div>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: 'rgba(0,0,0,0.2)' }}>
            {renderContent()}
          </div>

          {/* Footer mit Änderungsanzeige */}
          {hasChanges && (
            <div style={{
              padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '12px', color: '#f59e0b' }}>Änderungen werden live angezeigt</span>
              <button onClick={handleSaveAndClose} style={{
                padding: '8px 16px', background: '#22c55e', border: 'none', borderRadius: '6px',
                color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
              }}>Fertig</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
