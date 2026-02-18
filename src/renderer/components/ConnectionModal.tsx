import { useState, useEffect, useRef } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { ConnectionStatus } from '../../shared/types'

interface BluetoothDevice {
  id: string
  name: string
  rssi: number
}

// Wartezeit für GPS-Check nach Verbindung (in ms)
const GPS_CHECK_DELAY = 5000

// Extrahiere BLS Sensor Nummer aus dem Namen
function extractBLSSensorNumber(name: string): string | null {
  // Suche nach Muster wie "BLS 01", "BLS-02", "BLS01" etc.
  const match = name.match(/BLS[- ]?(\d+)/i)
  if (match) return match[1].padStart(2, '0')

  // Suche nach "Outgoing" oder "Ausgehend" im Namen
  if (name.toLowerCase().includes('outgoing') || name.toLowerCase().includes('ausgehend')) {
    // Versuche Nummer aus dem restlichen Namen zu extrahieren
    const numMatch = name.match(/(\d+)/)
    if (numMatch) return numMatch[1].padStart(2, '0')
  }

  return null
}

// Prüfe ob ein Gerät wahrscheinlich ein BLS Sensor ist
function isBLSDevice(device: BluetoothDevice): boolean {
  const nameLower = device.name.toLowerCase()
  // BLS-typische Namen
  return nameLower.includes('bls') ||
         nameLower.includes('flytec') ||
         nameLower.includes('brauniger') ||
         nameLower.includes('outgoing') ||
         nameLower.includes('ausgehend') ||
         nameLower.includes('bluetooth') ||
         nameLower.includes('serial')
}

// Sortiere Geräte - BLS-ähnliche zuerst
function sortDevices(devices: BluetoothDevice[]): BluetoothDevice[] {
  return [...devices].sort((a, b) => {
    const aIsBLS = isBLSDevice(a)
    const bIsBLS = isBLSDevice(b)
    if (aIsBLS && !bIsBLS) return -1
    if (!aIsBLS && bIsBLS) return 1
    return a.name.localeCompare(b.name)
  })
}

// Debug-Stats Typ
interface BLSDebugStats {
  ggaCount: number
  rmcCount: number
  baroCount: number
  checksumErrors: number
  parseErrors: number
  avgGGAInterval: number
  lastSentence: string
  parserType: string
  connectedSince: number
  lastError: string
  uptime: number
  qnh: number
  isConnected: boolean
  rawLog: string[]
}

export function ConnectionModal({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<BluetoothDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [showNoGpsWarning, setShowNoGpsWarning] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [showRawLog, setShowRawLog] = useState(false)
  const [debugStats, setDebugStats] = useState<BLSDebugStats | null>(null)
  const rawLogRef = useRef<HTMLDivElement>(null)
  const gpsCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const {
    isConnected, connectionError, setConnectionStatus, setConnectionError, setGPSData, setBaroData,
    settings, updateSettings, gpsData
  } = useFlightStore()

  // Zuletzt verbundenes BLS aus Settings
  const lastConnectedBLS = settings.lastConnectedBLS
  const lastConnectedBLSName = settings.lastConnectedBLSName

  // Scan für BLS Geräte
  const handleScan = async () => {
    setScanning(true)
    try {
      // @ts-ignore - window.ntaAPI wird vom Preload Script bereitgestellt
      const foundDevices = await window.ntaAPI?.bluetooth?.scan() || []
      console.log('[BLS Scan] Gefundene Geräte:', foundDevices)

      // Füge zuletzt verbundenes Gerät hinzu, falls es nicht im Scan erscheint
      let allDevices = [...foundDevices]
      if (lastConnectedBLS && !foundDevices.find((d: BluetoothDevice) => d.id === lastConnectedBLS)) {
        console.log('[BLS Scan] Füge zuletzt verbundenes Gerät hinzu:', lastConnectedBLS)
        allDevices.unshift({
          id: lastConnectedBLS,
          name: lastConnectedBLSName || 'BLS Sensor',
          rssi: 0
        })
      }

      // Zeige ALLE COM-Ports, sortiert mit BLS-ähnlichen zuerst
      const sortedDevices = sortDevices(allDevices)
      setDevices(sortedDevices)
    } catch (error) {
      console.error('Scan failed:', error)
    }
    setScanning(false)
  }

  // Mit Gerät verbinden
  const handleConnect = async (deviceId: string, deviceName?: string) => {
    setConnecting(true)
    setShowNoGpsWarning(false)
    setConnectionStatus(ConnectionStatus.Connecting)
    setConnectionError(null) // Clear previous errors
    try {
      // @ts-ignore
      const api = window.ntaAPI
      if (!api) {
        const errorMsg = 'ntaAPI ist nicht verfügbar. Bitte starte die App neu.'
        console.error(errorMsg)
        setConnectionStatus(ConnectionStatus.Error)
        setConnectionError(errorMsg)
        setConnecting(false)
        return
      }

      const result = await api.bluetooth.connect(deviceId)
      if (result.success) {
        setConnectionStatus(ConnectionStatus.Connected)
        setConnectionError(null)

        // Speichere zuletzt verbundenes BLS
        updateSettings({
          lastConnectedBLS: deviceId,
          lastConnectedBLSName: deviceName || deviceId
        })

        // GPS Daten abonnieren
        api.gps.subscribe((data: any) => {
          setGPSData(data)
        })

        // Baro Daten abonnieren
        api.baro.subscribe((data: any) => {
          setBaroData(data)
        })

        // Prüfe nach kurzer Zeit ob GPS-Daten kommen
        if (gpsCheckTimeoutRef.current) {
          clearTimeout(gpsCheckTimeoutRef.current)
        }
        gpsCheckTimeoutRef.current = setTimeout(() => {
          const currentGpsData = useFlightStore.getState().gpsData
          if (!currentGpsData) {
            setShowNoGpsWarning(true)
          }
        }, GPS_CHECK_DELAY)

        // Modal bleibt offen um GPS-Status zu zeigen
      } else {
        setConnectionStatus(ConnectionStatus.Error)
        setConnectionError(result.error || 'Verbindung fehlgeschlagen')
      }
    } catch (error: any) {
      console.error('Connection failed:', error)
      setConnectionStatus(ConnectionStatus.Error)
      const errorMsg = error?.message || 'Unbekannter Verbindungsfehler'
      setConnectionError(errorMsg)
    }
    setConnecting(false)
  }

  // Cleanup beim Unmount
  useEffect(() => {
    return () => {
      if (gpsCheckTimeoutRef.current) {
        clearTimeout(gpsCheckTimeoutRef.current)
      }
    }
  }, [])

  // Verbindung trennen
  const handleDisconnect = async () => {
    try {
      // @ts-ignore
      await window.ntaAPI?.bluetooth?.disconnect()
      setConnectionStatus(ConnectionStatus.Disconnected)
      // GPS und Baro Daten zurücksetzen
      setGPSData(null)
      setBaroData(null)
    } catch (error) {
      console.error('Disconnect failed:', error)
    }
  }

  // Initial Scan beim Öffnen
  useEffect(() => {
    handleScan()

    // Bluetooth Error Events abonnieren
    // @ts-ignore
    window.ntaAPI?.bluetooth?.onError?.((error: { message: string; details?: string }) => {
      setConnectionError(error.message)
      setConnectionStatus(ConnectionStatus.Error)
      setConnecting(false)
    })
  }, [])

  // Debug-Stats abonnieren wenn Panel offen
  useEffect(() => {
    if (!showDebug) return
    // @ts-ignore
    const api = window.ntaAPI?.bluetooth
    if (!api?.onDebug) return
    api.onDebug((stats: BLSDebugStats) => {
      setDebugStats(stats)
    })
    return () => {
      api.offDebug?.()
    }
  }, [showDebug])

  // Auto-Scroll Raw-Log nach unten
  useEffect(() => {
    if (rawLogRef.current && showRawLog) {
      rawLogRef.current.scrollTop = rawLogRef.current.scrollHeight
    }
  }, [debugStats?.rawLog?.length, showRawLog])

  // Erzeuge einen lesbaren Namen für das Gerät
  const getDisplayName = (device: BluetoothDevice): string => {
    const sensorNum = extractBLSSensorNumber(device.name)
    if (sensorNum) {
      return `BLS Sensor ${sensorNum}`
    }

    // Wenn BLS-ähnlich, zeige "BLS Sensor"
    if (isBLSDevice(device)) {
      return 'BLS Sensor'
    }

    // Ansonsten zeige den originalen Namen mit COM-Port
    const comMatch = device.id.match(/COM(\d+)/i)
    if (comMatch) {
      return `${device.name || 'Serieller Port'} (COM${comMatch[1]})`
    }

    return device.name || device.id
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: showRawLog ? '500px' : '340px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          border: '1px solid rgba(255,255,255,0.1)',
          transition: 'width 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
              <path d="M14.24 12.01l2.32 2.32c.28-.72.44-1.51.44-2.33 0-.82-.16-1.59-.43-2.31l-2.33 2.32zm5.29-5.3l-1.26 1.26c.63 1.21.98 2.57.98 4.02s-.36 2.82-.98 4.02l1.2 1.2a9.936 9.936 0 001.54-5.31c-.01-1.89-.55-3.67-1.48-5.19zm-3.82 1L10 2H9v7.59L4.41 5 3 6.41 8.59 12 3 17.59 4.41 19 9 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM11 5.83l1.88 1.88L11 9.59V5.83zm1.88 10.46L11 18.17v-3.76l1.88 1.88z"/>
            </svg>
            <span style={{ fontWeight: 700, color: 'white', fontSize: '15px' }}>BLS Sensor</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '16px' }}>
          {/* Status wenn verbunden */}
          {isConnected ? (
            <div style={{
              padding: '16px',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: '10px',
              marginBottom: '12px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '12px'
              }}>
                <span style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 8px #22c55e'
                }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'white', fontSize: '14px' }}>Verbunden</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                    {settings.lastConnectedBLSName || 'Flytec Balloon Live Sensor'}
                  </div>
                </div>
              </div>

              {/* GPS Status */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                marginBottom: '12px',
                background: gpsData ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                border: gpsData ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: '8px'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={gpsData ? '#22c55e' : '#f59e0b'} strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                </svg>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: gpsData ? '#22c55e' : '#f59e0b'
                  }}>
                    {gpsData ? 'GPS aktiv' : 'Warte auf GPS...'}
                  </div>
                  {gpsData && (
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
                      {gpsData.satellites} Satelliten • HDOP {gpsData.hdop?.toFixed(1) || '?'}
                    </div>
                  )}
                </div>
              </div>

              {/* Kein GPS Warnung */}
              {showNoGpsWarning && !gpsData && (
                <div style={{
                  padding: '12px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '8px',
                  marginBottom: '12px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px'
                  }}>
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="#f59e0b" style={{ flexShrink: 0, marginTop: '1px' }}>
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: '#f59e0b', fontSize: '12px', marginBottom: '4px' }}>
                        Kein GPS-Signal
                      </div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                        Der BLS Sensor empfängt aktuell kein GPS-Signal. Bitte stelle sicher, dass der Sensor freie Sicht zum Himmel hat.
                      </div>
                    </div>
                    <button
                      onClick={() => setShowNoGpsWarning(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        padding: '2px',
                        fontSize: '14px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* BLS Debug Monitor */}
              <button
                onClick={() => setShowDebug(!showDebug)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  marginBottom: '12px',
                  background: showDebug ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)',
                  border: showDebug ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: showDebug ? '#3b82f6' : 'rgba(255,255,255,0.5)',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                <span>BLS Monitor</span>
                <span style={{ fontSize: '10px' }}>{showDebug ? '▲' : '▼'}</span>
              </button>

              {showDebug && debugStats && (
                <div style={{
                  padding: '12px',
                  marginBottom: '12px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(59,130,246,0.2)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  lineHeight: 1.8,
                  color: 'rgba(255,255,255,0.7)'
                }}>
                  {/* Parser Type */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Parser:</span>
                    <span style={{ color: debugStats.parserType === 'readline' ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                      {debugStats.parserType === 'readline' ? 'ReadlineParser' : 'Manual Buffer'}
                    </span>
                  </div>

                  {/* Uptime */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Uptime:</span>
                    <span>{Math.floor(debugStats.uptime / 60)}m {debugStats.uptime % 60}s</span>
                  </div>

                  {/* QNH */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>QNH:</span>
                    <span style={{ color: debugStats.qnh !== 1013.25 ? '#22c55e' : 'rgba(255,255,255,0.4)' }}>
                      {debugStats.qnh.toFixed(2)} hPa
                    </span>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0' }} />

                  {/* NMEA Counts */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>GGA (Position):</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{debugStats.ggaCount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>RMC (Speed/Hdg):</span>
                    <span>{debugStats.rmcCount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Baro (PGRMZ/LX):</span>
                    <span>{debugStats.baroCount}</span>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0' }} />

                  {/* GPS Rate */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>GPS Rate:</span>
                    <span style={{
                      fontWeight: 600,
                      color: debugStats.avgGGAInterval > 0 && debugStats.avgGGAInterval < 300
                        ? '#22c55e'
                        : debugStats.avgGGAInterval > 0
                        ? '#f59e0b'
                        : 'rgba(255,255,255,0.4)'
                    }}>
                      {debugStats.avgGGAInterval > 0
                        ? `${Math.round(1000 / debugStats.avgGGAInterval * 10) / 10} Hz (${Math.round(debugStats.avgGGAInterval)}ms)`
                        : 'warte...'}
                    </span>
                  </div>

                  {/* Last Sentence */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Letzter Satz:</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>{debugStats.lastSentence || '---'}</span>
                  </div>

                  {/* Errors */}
                  {(debugStats.checksumErrors > 0 || debugStats.parseErrors > 0) && (
                    <>
                      <div style={{ borderTop: '1px solid rgba(239,68,68,0.3)', margin: '6px 0' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444' }}>
                        <span>Checksum-Fehler:</span>
                        <span style={{ fontWeight: 600 }}>{debugStats.checksumErrors}</span>
                      </div>
                      {debugStats.parseErrors > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444' }}>
                          <span>Parse-Fehler:</span>
                          <span style={{ fontWeight: 600 }}>{debugStats.parseErrors}</span>
                        </div>
                      )}
                    </>
                  )}

                  {/* Last Error */}
                  {debugStats.lastError && (
                    <div style={{ marginTop: '6px', color: '#ef4444', fontSize: '10px', wordBreak: 'break-all' }}>
                      {debugStats.lastError}
                    </div>
                  )}

                  {/* Raw NMEA Log Toggle */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }} />
                  <button
                    onClick={() => setShowRawLog(!showRawLog)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: showRawLog ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                      border: showRawLog ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      color: showRawLog ? '#a855f7' : 'rgba(255,255,255,0.5)',
                      fontSize: '10px',
                      fontWeight: 600,
                      fontFamily: 'monospace',
                    }}
                  >
                    <span>Raw NMEA Log ({debugStats.rawLog?.length || 0})</span>
                    <span>{showRawLog ? '▲' : '▼'}</span>
                  </button>

                  {showRawLog && debugStats.rawLog && debugStats.rawLog.length > 0 && (
                    <div
                      ref={rawLogRef}
                      style={{
                        marginTop: '6px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        background: 'rgba(0,0,0,0.5)',
                        border: '1px solid rgba(168,85,247,0.2)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '9px',
                        fontFamily: 'monospace',
                        lineHeight: 1.6,
                        color: 'rgba(255,255,255,0.6)',
                        whiteSpace: 'pre',
                        wordBreak: 'break-all',
                      }}
                    >
                      {debugStats.rawLog.map((line, i) => {
                        // Farbcodierung nach NMEA-Typ
                        let color = 'rgba(255,255,255,0.5)'
                        if (line.includes('$GPGGA') || line.includes('$GNGGA')) color = '#22c55e'
                        else if (line.includes('$GPRMC') || line.includes('$GNRMC')) color = '#3b82f6'
                        else if (line.includes('$PFLAC')) color = '#f59e0b'
                        else if (line.includes('$PGRMZ') || line.includes('$LXWP')) color = '#a855f7'
                        else if (line.includes('$PFLAU')) color = '#06b6d4'
                        return (
                          <div key={i} style={{ color }}>
                            {line}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleDisconnect}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Trennen
                </button>
                <button
                  onClick={onClose}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Schließen
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Error Display */}
              {connectionError && (
                <div style={{
                  padding: '12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '10px',
                  marginBottom: '12px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px'
                  }}>
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }}>
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: '#ef4444', fontSize: '12px', marginBottom: '4px' }}>
                        Verbindungsfehler
                      </div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
                        {connectionError}
                      </div>
                    </div>
                    <button
                      onClick={() => setConnectionError(null)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        padding: '2px',
                        fontSize: '14px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Scan Button */}
              <button
                onClick={handleScan}
                disabled={scanning}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '12px',
                  background: scanning ? 'rgba(59, 130, 246, 0.3)' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: scanning ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {scanning ? (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      style={{ animation: 'spin 1s linear infinite' }}
                    >
                      <path d="M8 1a7 7 0 00-7 7h2a5 5 0 015-5V1z" />
                    </svg>
                    Suche läuft...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    Nach Sensoren suchen
                  </>
                )}
              </button>

              {/* Zuletzt verbundener BLS */}
              {lastConnectedBLS && !devices.find(d => d.id === lastConnectedBLS) && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '6px',
                    textTransform: 'uppercase'
                  }}>
                    Zuletzt verbunden
                  </div>
                  <button
                    onClick={() => handleConnect(lastConnectedBLS, lastConnectedBLSName || undefined)}
                    disabled={connecting}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      background: 'rgba(34, 197, 94, 0.1)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: '10px',
                      cursor: connecting ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => {
                      if (!connecting) {
                        e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'
                    }}
                  >
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(34, 197, 94, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                        <path d="M14.24 12.01l2.32 2.32c.28-.72.44-1.51.44-2.33 0-.82-.16-1.59-.43-2.31l-2.33 2.32zm5.29-5.3l-1.26 1.26c.63 1.21.98 2.57.98 4.02s-.36 2.82-.98 4.02l1.2 1.2a9.936 9.936 0 001.54-5.31c-.01-1.89-.55-3.67-1.48-5.19zm-3.82 1L10 2H9v7.59L4.41 5 3 6.41 8.59 12 3 17.59 4.41 19 9 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM11 5.83l1.88 1.88L11 9.59V5.83zm1.88 10.46L11 18.17v-3.76l1.88 1.88z"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{
                        fontWeight: 600,
                        color: 'white',
                        fontSize: '14px'
                      }}>
                        {lastConnectedBLSName || 'BLS Sensor'}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: '#22c55e'
                      }}>
                        Erneut verbinden
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Device List */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {devices.length === 0 && !lastConnectedBLS ? (
                  <div style={{
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.4)',
                    padding: '24px',
                    fontSize: '12px'
                  }}>
                    {scanning ? (
                      <span>Suche nach BLS Sensoren...</span>
                    ) : (
                      <>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 8px', opacity: 0.5, display: 'block' }}>
                          <path d="M14.24 12.01l2.32 2.32c.28-.72.44-1.51.44-2.33 0-.82-.16-1.59-.43-2.31l-2.33 2.32zm5.29-5.3l-1.26 1.26c.63 1.21.98 2.57.98 4.02s-.36 2.82-.98 4.02l1.2 1.2a9.936 9.936 0 001.54-5.31c-.01-1.89-.55-3.67-1.48-5.19z"/>
                        </svg>
                        <div>Keine BLS Sensoren gefunden</div>
                      </>
                    )}
                  </div>
                ) : devices.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.4)',
                    padding: '12px',
                    fontSize: '11px'
                  }}>
                    {scanning ? 'Suche nach weiteren Sensoren...' : 'Keine neuen Sensoren gefunden'}
                  </div>
                ) : (
                  <>
                    {devices.length > 0 && lastConnectedBLS && (
                      <div style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.5)',
                        marginBottom: '2px',
                        textTransform: 'uppercase'
                      }}>
                        Verfügbare Sensoren
                      </div>
                    )}
                    {devices.map((device) => {
                      const isLastConnected = device.id === lastConnectedBLS
                      const accentColor = isLastConnected ? '#22c55e' : '#3b82f6'
                      return (
                        <button
                          key={device.id}
                          onClick={() => handleConnect(device.id, getDisplayName(device))}
                          disabled={connecting}
                          style={{
                            width: '100%',
                            padding: '14px 16px',
                            background: isLastConnected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.05)',
                            border: isLastConnected ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '10px',
                            cursor: connecting ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            transition: 'all 0.15s'
                          }}
                          onMouseEnter={e => {
                            if (!connecting) {
                              e.currentTarget.style.background = isLastConnected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.15)'
                              e.currentTarget.style.borderColor = isLastConnected ? 'rgba(34, 197, 94, 0.5)' : 'rgba(59, 130, 246, 0.3)'
                            }
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = isLastConnected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.05)'
                            e.currentTarget.style.borderColor = isLastConnected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.1)'
                          }}
                        >
                          <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: isLastConnected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2">
                              <path d="M14.24 12.01l2.32 2.32c.28-.72.44-1.51.44-2.33 0-.82-.16-1.59-.43-2.31l-2.33 2.32zm5.29-5.3l-1.26 1.26c.63 1.21.98 2.57.98 4.02s-.36 2.82-.98 4.02l1.2 1.2a9.936 9.936 0 001.54-5.31c-.01-1.89-.55-3.67-1.48-5.19zm-3.82 1L10 2H9v7.59L4.41 5 3 6.41 8.59 12 3 17.59 4.41 19 9 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM11 5.83l1.88 1.88L11 9.59V5.83zm1.88 10.46L11 18.17v-3.76l1.88 1.88z"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1, textAlign: 'left' }}>
                            <div style={{
                              fontWeight: 600,
                              color: 'white',
                              fontSize: '14px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}>
                              {getDisplayName(device)}
                              {isLastConnected && (
                                <span style={{
                                  fontSize: '9px',
                                  background: 'rgba(34, 197, 94, 0.3)',
                                  color: '#22c55e',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontWeight: 600
                                }}>ZULETZT</span>
                              )}
                            </div>
                            <div style={{
                              fontSize: '11px',
                              color: isLastConnected ? '#22c55e' : 'rgba(255,255,255,0.4)'
                            }}>
                              {device.id} {isBLSDevice(device) && '• BLS kompatibel'}
                            </div>
                          </div>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isLastConnected ? '#22c55e' : 'rgba(255,255,255,0.3)'} strokeWidth="2">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            </>
          )}

          {/* Info */}
          <div style={{
            marginTop: '16px',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '8px',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.5
          }}>
            <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Hinweis:</strong> BLS Sensor muss eingeschaltet und mit dem PC gepairt sein.
          </div>
        </div>

        {/* Keyframes für Spinner */}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}
