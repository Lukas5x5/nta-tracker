import React, { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'

// Vordefinierte Regionen für einfache Auswahl
const PREDEFINED_REGIONS = [
  { name: 'Österreich', bounds: { north: 49.02, south: 46.37, east: 17.16, west: 9.53 }, estimatedSize: '15 GB' },
  { name: 'Deutschland', bounds: { north: 55.06, south: 47.27, east: 15.04, west: 5.87 }, estimatedSize: '40 GB' },
  { name: 'Schweiz', bounds: { north: 47.81, south: 45.82, east: 10.49, west: 5.96 }, estimatedSize: '8 GB' },
  { name: 'Tschechien', bounds: { north: 51.06, south: 48.55, east: 18.86, west: 12.09 }, estimatedSize: '12 GB' },
  { name: 'Ungarn', bounds: { north: 48.59, south: 45.74, east: 22.90, west: 16.11 }, estimatedSize: '14 GB' },
  { name: 'Polen', bounds: { north: 54.84, south: 49.00, east: 24.15, west: 14.12 }, estimatedSize: '25 GB' },
  { name: 'Italien (Nord)', bounds: { north: 47.09, south: 43.50, east: 14.00, west: 6.63 }, estimatedSize: '18 GB' },
  { name: 'Slowenien', bounds: { north: 46.88, south: 45.42, east: 16.61, west: 13.38 }, estimatedSize: '4 GB' },
  { name: 'Slowakei', bounds: { north: 49.61, south: 47.73, east: 22.57, west: 16.84 }, estimatedSize: '8 GB' },
  { name: 'Kroatien', bounds: { north: 46.55, south: 42.39, east: 19.43, west: 13.49 }, estimatedSize: '10 GB' },
]

interface DownloadProgress {
  total: number
  downloaded: number
  cached: number
  failed: number
  currentTile: string
  estimatedTimeRemaining?: string
  bytesDownloaded?: number
}

interface RegionDownloadPanelProps {
  onClose: () => void
}

export function RegionDownloadPanel({ onClose }: RegionDownloadPanelProps) {
  const { user } = useAuthStore()

  // Prüfe Admin-Berechtigung
  if (!user?.is_admin) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <div style={{
          background: '#1a1a2e',
          padding: 32,
          borderRadius: 12,
          textAlign: 'center'
        }}>
          <div style={{ color: '#ef4444', fontSize: 18, marginBottom: 16 }}>
            ⛔ Keine Berechtigung
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 24 }}>
            Nur Administratoren können Regionen herunterladen.
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Schließen
          </button>
        </div>
      </div>
    )
  }

  const [selectedRegion, setSelectedRegion] = useState<typeof PREDEFINED_REGIONS[0] | null>(null)
  const [customRegion, setCustomRegion] = useState({
    name: '',
    north: '',
    south: '',
    east: '',
    west: ''
  })
  const [useCustom, setUseCustom] = useState(false)
  const [minZoom, setMinZoom] = useState(8)
  const [maxZoom, setMaxZoom] = useState(17)
  const [isDownloading, setIsDownloading] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [downloadComplete, setDownloadComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const abortRef = useRef({ aborted: false })

  // Berechne geschätzte Tile-Anzahl
  const calculateTileCount = (bounds: { north: number; south: number; east: number; west: number }) => {
    let total = 0
    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z)
      const xMin = Math.floor((bounds.west + 180) / 360 * n)
      const xMax = Math.floor((bounds.east + 180) / 360 * n)
      const yMin = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
      const yMax = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)
      total += (xMax - xMin + 1) * (yMax - yMin + 1)
    }
    return total
  }

  const getCurrentBounds = () => {
    if (useCustom) {
      return {
        north: parseFloat(customRegion.north),
        south: parseFloat(customRegion.south),
        east: parseFloat(customRegion.east),
        west: parseFloat(customRegion.west)
      }
    }
    return selectedRegion?.bounds || null
  }

  const getCurrentName = () => {
    if (useCustom) return customRegion.name || 'custom'
    return selectedRegion?.name || ''
  }

  const bounds = getCurrentBounds()
  const tileCount = bounds ? calculateTileCount(bounds) : 0
  const estimatedSize = Math.round(tileCount * 15 / 1024) // ~15 KB pro Tile

  const startDownload = async () => {
    if (!bounds) return

    setIsDownloading(true)
    setError(null)
    setDownloadComplete(false)
    abortRef.current = { aborted: false }

    try {
      // Rufe die Electron API zum Herunterladen auf
      const result = await window.ntaAPI?.tiles?.downloadRegion?.(
        getCurrentName(),
        bounds,
        minZoom,
        maxZoom,
        (prog: DownloadProgress) => {
          setProgress(prog)
        },
        abortRef.current
      )

      if (result?.success) {
        setDownloadComplete(true)
        setOutputPath(result.outputPath || null)
      } else {
        setError(result?.error || 'Download fehlgeschlagen')
      }
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler')
    } finally {
      setIsDownloading(false)
    }
  }

  const abortDownload = () => {
    abortRef.current.aborted = true
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div style={{
        background: '#1a1a2e',
        borderRadius: 16,
        width: '90%',
        maxWidth: 800,
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>🗺️</span>
              Region herunterladen
              <span style={{
                background: '#a855f7',
                color: '#fff',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                marginLeft: 8
              }}>
                ADMIN
              </span>
            </h2>
            <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              Lade eine komplette Region herunter für den Tile-Server
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 24,
              cursor: 'pointer',
              padding: 8
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24 }}>
          {/* Region Auswahl */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.7)', marginBottom: 12, fontWeight: 500 }}>
              Region auswählen
            </label>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                onClick={() => setUseCustom(false)}
                style={{
                  padding: '8px 16px',
                  background: !useCustom ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                  color: !useCustom ? '#fff' : 'rgba(255,255,255,0.6)',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                Vordefiniert
              </button>
              <button
                onClick={() => setUseCustom(true)}
                style={{
                  padding: '8px 16px',
                  background: useCustom ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                  color: useCustom ? '#fff' : 'rgba(255,255,255,0.6)',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                Eigene Koordinaten
              </button>
            </div>

            {!useCustom ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {PREDEFINED_REGIONS.map(region => (
                  <button
                    key={region.name}
                    onClick={() => setSelectedRegion(region)}
                    style={{
                      padding: '12px 16px',
                      background: selectedRegion?.name === region.name ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                      border: selectedRegion?.name === region.name ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{region.name}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                      ~{region.estimatedSize}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <input
                    type="text"
                    placeholder="Name der Region"
                    value={customRegion.name}
                    onChange={e => setCustomRegion(prev => ({ ...prev, name: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 6,
                      color: '#fff'
                    }}
                  />
                </div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Nord (z.B. 49.02)"
                  value={customRegion.north}
                  onChange={e => setCustomRegion(prev => ({ ...prev, north: e.target.value }))}
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fff'
                  }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Süd (z.B. 46.37)"
                  value={customRegion.south}
                  onChange={e => setCustomRegion(prev => ({ ...prev, south: e.target.value }))}
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fff'
                  }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ost (z.B. 17.16)"
                  value={customRegion.east}
                  onChange={e => setCustomRegion(prev => ({ ...prev, east: e.target.value }))}
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fff'
                  }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="West (z.B. 9.53)"
                  value={customRegion.west}
                  onChange={e => setCustomRegion(prev => ({ ...prev, west: e.target.value }))}
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fff'
                  }}
                />
              </div>
            )}
          </div>

          {/* Zoom Level */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.7)', marginBottom: 12, fontWeight: 500 }}>
              Zoom-Stufen
            </label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginRight: 8 }}>Von:</span>
                <select
                  value={minZoom}
                  onChange={e => setMinZoom(parseInt(e.target.value))}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fff'
                  }}
                >
                  {[6, 7, 8, 9, 10].map(z => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginRight: 8 }}>Bis:</span>
                <select
                  value={maxZoom}
                  onChange={e => setMaxZoom(parseInt(e.target.value))}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#fff'
                  }}
                >
                  {[14, 15, 16, 17, 18].map(z => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div style={{
                marginLeft: 'auto',
                padding: '8px 16px',
                background: 'rgba(59, 130, 246, 0.1)',
                borderRadius: 6,
                color: '#3b82f6'
              }}>
                Empfohlen: 8-17
              </div>
            </div>
          </div>

          {/* Statistiken */}
          {bounds && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 12,
              padding: 20,
              marginBottom: 24
            }}>
              <h4 style={{ margin: '0 0 16px', color: '#fff' }}>Geschätzte Werte</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Tiles</div>
                  <div style={{ color: '#fff', fontSize: 20, fontWeight: 600 }}>
                    {tileCount.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Größe</div>
                  <div style={{ color: '#fff', fontSize: 20, fontWeight: 600 }}>
                    ~{estimatedSize > 1024 ? `${(estimatedSize / 1024).toFixed(1)} GB` : `${estimatedSize} MB`}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Dauer (OSM)</div>
                  <div style={{ color: '#fff', fontSize: 20, fontWeight: 600 }}>
                    ~{Math.round(tileCount / 2 / 3600)} Std
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                    bei 2 Tiles/Sek
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fortschritt */}
          {isDownloading && progress && (
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: 12,
              padding: 20,
              marginBottom: 24
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#fff' }}>Download läuft...</span>
                <span style={{ color: '#3b82f6' }}>
                  {((progress.downloaded + progress.cached) / progress.total * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{
                height: 8,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 12
              }}>
                <div style={{
                  height: '100%',
                  width: `${(progress.downloaded + progress.cached) / progress.total * 100}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                  borderRadius: 4,
                  transition: 'width 0.3s'
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                <span>{progress.downloaded.toLocaleString()} heruntergeladen</span>
                <span>{progress.cached.toLocaleString()} bereits vorhanden</span>
                <span>{progress.failed} fehlgeschlagen</span>
              </div>
              {progress.currentTile && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Aktuell: {progress.currentTile}
                </div>
              )}
            </div>
          )}

          {/* Erfolg */}
          {downloadComplete && (
            <div style={{
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: 12,
              padding: 20,
              marginBottom: 24,
              border: '1px solid rgba(34, 197, 94, 0.3)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>✅</span>
                <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 16 }}>Download abgeschlossen!</span>
              </div>
              {outputPath && (
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                  Gespeichert unter: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>{outputPath}</code>
                </div>
              )}
              <div style={{ marginTop: 16, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                <div style={{ color: '#fff', fontWeight: 500, marginBottom: 8 }}>Nächste Schritte:</div>
                <ol style={{ margin: 0, paddingLeft: 20, color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 1.8 }}>
                  <li>Lade die .mbtiles Datei auf deinen Server hoch</li>
                  <li>Konfiguriere den Tile-Server (siehe Dokumentation)</li>
                  <li>Teste den Zugriff über die Server-URL</li>
                </ol>
              </div>
            </div>
          )}

          {/* Fehler */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444'
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            {isDownloading ? (
              <button
                onClick={abortDownload}
                style={{
                  padding: '12px 24px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                Abbrechen
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  style={{
                    padding: '12px 24px',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    cursor: 'pointer'
                  }}
                >
                  Schließen
                </button>
                <button
                  onClick={startDownload}
                  disabled={!bounds}
                  style={{
                    padding: '12px 24px',
                    background: bounds ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                    color: bounds ? '#fff' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: bounds ? 'pointer' : 'not-allowed',
                    fontWeight: 500
                  }}
                >
                  🚀 Download starten
                </button>
              </>
            )}
          </div>
        </div>

        {/* Hinweis */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 16 }}>ℹ️</span>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Hinweis:</strong> Der Download von OSM-Tiles ist auf ~2 Tiles/Sekunde limitiert.
              Große Regionen können mehrere Stunden dauern. Die Datei wird als MBTiles (SQLite) gespeichert und kann
              dann auf den Server hochgeladen werden.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
