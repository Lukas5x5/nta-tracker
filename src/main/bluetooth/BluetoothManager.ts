import { EventEmitter } from 'events'

// SerialPort wird lazy geladen um Probleme mit native Addons zu vermeiden
let SerialPortModule: typeof import('serialport') | null = null
let ReadlineParserClass: any = null
type SerialPortType = import('serialport').SerialPort

function getSerialPort(): typeof import('serialport').SerialPort | null {
  if (!SerialPortModule) {
    try {
      SerialPortModule = require('serialport')
      ReadlineParserClass = require('@serialport/parser-readline').ReadlineParser
    } catch (err) {
      console.warn('SerialPort konnte nicht geladen werden:', err)
      return null
    }
  }
  return SerialPortModule!.SerialPort
}

interface GPSData {
  latitude: number
  longitude: number
  altitude: number
  speed: number
  heading: number
  timestamp: Date
  satellites: number
  hdop: number
}

interface BaroData {
  pressureAltitude: number
  qnh: number
  variometer: number
  timestamp: Date
}

interface BluetoothDevice {
  id: string
  name: string
  rssi: number
}

/**
 * BluetoothManager - Verwaltet die Verbindung zum Flytec BLS Sensor
 *
 * Der BLS Sensor unterstützt:
 * - Bluetooth LE für die Balloon Live App
 * - Bluetooth SPP (Serial Port Profile) mit NMEA für Mapping Software
 *
 * Wir nutzen SPP über einen virtuellen COM Port für NMEA Daten
 */
export class BluetoothManager extends EventEmitter {
  private port: SerialPortType | null = null
  private parser: any = null  // ReadlineParser — liefert saubere NMEA-Zeilen
  private buffer: string = ''  // Fallback-Buffer wenn ReadlineParser nicht verfügbar
  private isConnected: boolean = false
  private gpsCallbacks: ((data: GPSData) => void)[] = []
  private baroCallbacks: ((data: BaroData) => void)[] = []

  // Letzte bekannte Werte für Variometer-Berechnung
  private lastAltitude: number = 0
  private lastAltitudeTime: number = 0

  // Letzte gültige Speed/Heading aus RMC - GGA sendet kein Speed/Heading
  private lastValidSpeed: number = 0
  private lastValidHeading: number = 0
  private hasValidHeading: boolean = false

  // QNH vom BLS Sensor (über PFLAC Satz)
  private lastQNH: number = 1013.25

  // Debug-Statistiken für BLS Monitor
  private debugStats = {
    ggaCount: 0,
    rmcCount: 0,
    baroCount: 0,
    checksumErrors: 0,
    parseErrors: 0,
    lastGGATime: 0,         // Timestamp des letzten GGA
    avgGGAInterval: 0,      // Durchschnittlicher GGA-Intervall (ms)
    lastSentence: '',       // Letzter empfangener NMEA-Satz (Typ)
    parserType: 'unknown' as string,  // 'readline' oder 'manual'
    connectedSince: 0,      // Zeitpunkt der Verbindung
    lastError: '',          // Letzter Fehler
  }
  private rawLog: string[] = []         // Letzte N raw NMEA Sätze
  private readonly RAW_LOG_MAX = 50     // Max Anzahl gespeicherter Sätze
  private debugInterval: ReturnType<typeof setInterval> | null = null

  // Glättungsfilter für stabile Anzeige (EMA = Exponential Moving Average)
  // HINWEIS: Position/Heading werden NICHT geglättet — das macht der "Render In The Past"
  // Algorithmus im MapView (60fps Interpolation zwischen bekannten GPS-Punkten).
  // Nur Variometer und Speed werden hier geglättet (für Anzeige in StatusBar).
  private smoothedVariometer: number = 0
  private smoothedSpeed: number = 0
  private readonly VARIO_SMOOTHING = 0.3  // Stärkere Glättung für Variometer (0.3 = 30% neuer Wert)
  private readonly SPEED_SMOOTHING = 0.4  // Moderate Glättung für Speed

  constructor() {
    super()
  }

  /**
   * Holt Bluetooth-Gerätenamen aus Windows (PowerShell)
   */
  private async getBluetoothDeviceNames(): Promise<Map<string, string>> {
    const deviceNames = new Map<string, string>()

    if (process.platform !== 'win32') {
      return deviceNames
    }

    try {
      const { exec } = require('child_process')
      const util = require('util')
      const execPromise = util.promisify(exec)

      // PowerShell Befehl um gekoppelte Bluetooth-Geräte zu finden
      const psCommand = `
        Get-PnpDevice -Class Bluetooth | Where-Object { $_.Status -eq 'OK' } | ForEach-Object {
          $device = $_
          $props = Get-PnpDeviceProperty -InstanceId $device.InstanceId
          $name = ($props | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_FriendlyName' }).Data
          $address = ($props | Where-Object { $_.KeyName -eq 'DEVPKEY_Bluetooth_DeviceAddress' }).Data
          if ($name -and $name -match 'BLS') {
            Write-Output "$name|$address"
          }
        }
      `

      const { stdout } = await execPromise(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, { timeout: 5000 })

      if (stdout) {
        const lines = stdout.trim().split('\n')
        for (const line of lines) {
          const [name, address] = line.trim().split('|')
          if (name && address) {
            console.log(`[BLS] Gefunden: ${name} (${address})`)
            // Speichere mit verschiedenen Formaten für die Zuordnung
            deviceNames.set(address?.toLowerCase(), name)
            deviceNames.set(name.toLowerCase(), name)
          }
        }
      }
    } catch (err) {
      console.log('[BLS] PowerShell Abfrage fehlgeschlagen (normal auf nicht-Windows):', err)
    }

    // Alternative: Durchsuche auch die Registry nach BLS Geräten
    try {
      const { exec } = require('child_process')
      const util = require('util')
      const execPromise = util.promisify(exec)

      // Registry-Abfrage für Bluetooth-Geräte
      const regCommand = `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices" /s 2>nul | findstr /i "Name BLS"`

      const { stdout } = await execPromise(regCommand, { timeout: 3000 }).catch(() => ({ stdout: '' }))

      if (stdout) {
        // Parse Registry Output für BLS Namen
        const matches = stdout.match(/Name\s+REG_SZ\s+(BLS[^\r\n]+)/gi)
        if (matches) {
          for (const match of matches) {
            const nameMatch = match.match(/Name\s+REG_SZ\s+(.+)/i)
            if (nameMatch) {
              const blsName = nameMatch[1].trim()
              console.log(`[BLS] Registry Fund: ${blsName}`)
              deviceNames.set(blsName.toLowerCase(), blsName)
            }
          }
        }
      }
    } catch (err) {
      // Registry-Fehler ignorieren
    }

    return deviceNames
  }

  /**
   * Scannt nach verfügbaren seriellen Ports (BLS Sensor)
   */
  async scanForDevices(): Promise<BluetoothDevice[]> {
    try {
      const SP = getSerialPort()
      if (!SP) {
        console.warn('SerialPort nicht verfügbar')
        return []
      }

      console.log('Scanne nach seriellen Ports...')

      // Hole Bluetooth-Gerätenamen parallel
      const [ports, btNames] = await Promise.all([
        SP.list(),
        this.getBluetoothDeviceNames()
      ])

      console.log('Gefundene Ports:', ports)
      console.log('Bluetooth Namen:', Array.from(btNames.entries()))

      // Zeige ALLE COM-Ports an, nicht nur gefilterte
      const devices = ports.map(port => {
        const portAny = port as any

        // Versuche BLS Namen aus verschiedenen Quellen zu finden
        let name = ''

        // 1. Prüfe ob friendlyName "BLS" enthält
        const friendlyName = portAny.friendlyName || ''
        if (friendlyName.toUpperCase().includes('BLS')) {
          name = friendlyName
        }

        // 2. Prüfe Bluetooth-Namen Map
        if (!name) {
          // Suche in allen bekannten BLS Namen
          for (const [key, blsName] of btNames.entries()) {
            if (blsName.toUpperCase().includes('BLS')) {
              // Prüfe ob dieser Port zu einem BLS gehören könnte
              if (friendlyName.toLowerCase().includes('bluetooth') ||
                  friendlyName.toLowerCase().includes('serial') ||
                  portAny.manufacturer?.toLowerCase().includes('bluetooth')) {
                name = blsName
                break
              }
            }
          }
        }

        // 3. Fallback auf friendlyName oder manufacturer
        if (!name) {
          name = friendlyName || port.manufacturer || ''
        }

        if (!name) {
          name = 'Serieller Port'
        }

        // Entferne COM-Port aus dem Namen falls vorhanden (wird separat angezeigt)
        name = name.replace(/\s*\(COM\d+\)\s*/gi, '').trim()

        return {
          id: port.path,  // z.B. "COM3" oder "/dev/ttyUSB0"
          name: name,
          rssi: 0 // Nicht verfügbar für serielle Ports
        }
      })

      console.log('Geräte für UI:', devices)
      return devices
    } catch (error) {
      console.error('Fehler beim Scannen:', error)
      return []
    }
  }

  /**
   * Verbindet mit dem BLS Sensor über den angegebenen Port
   */
  async connect(portPath: string): Promise<boolean> {
    try {
      if (this.port?.isOpen) {
        await this.disconnect()
      }

      const SP = getSerialPort()
      if (!SP) {
        console.warn('SerialPort nicht verfügbar')
        return false
      }

      return new Promise((resolve) => {
        // Port mit autoOpen: false erstellen, um Fehler abfangen zu können
        let port: SerialPortType
        try {
          port = new SP({
            path: portPath,
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            autoOpen: false  // Wichtig: Nicht automatisch öffnen
          })
        } catch (err) {
          console.error('Fehler beim Erstellen des Ports:', err)
          resolve(false)
          return
        }

        this.port = port

        // Event-Handler registrieren BEVOR wir öffnen
        port.on('open', () => {
          this.isConnected = true
          this.debugStats.connectedSince = Date.now()
          this.emit('connected')
          console.log(`Verbunden mit BLS auf ${portPath}`)

          // Konfiguriere BLS für schnellere Updates
          this.configureDevice()

          // Debug-Stats alle 500ms per Event senden
          this.startDebugEmitter()

          resolve(true)
        })

        // ReadlineParser: Liefert komplette NMEA-Zeilen bei jedem \r\n
        // Eliminiert das Problem von fragmentierten Buffer-Chunks
        if (ReadlineParserClass) {
          this.debugStats.parserType = 'readline'
          this.parser = port.pipe(new ReadlineParserClass({ delimiter: '\r\n' }))
          this.parser.on('data', (line: string) => {
            if (line.startsWith('$')) {
              this.parseNMEASentence(line)
            }
          })
        } else {
          this.debugStats.parserType = 'manual'
          // Fallback: manuelles Buffer-Splitting (weniger präzise Timestamps)
          port.on('data', (data: Buffer) => {
            this.processNMEAData(data.toString())
          })
        }

        port.on('error', (err: Error) => {
          console.error('Serieller Port Fehler:', err.message)
          this.isConnected = false
          this.port = null
          this.emit('error', err)
        })

        port.on('close', () => {
          this.isConnected = false
          this.emit('disconnected')
        })

        // Jetzt manuell öffnen mit Callback
        port.open((err) => {
          if (err) {
            const errorMsg = `Fehler beim Öffnen des Ports: ${err.message}`
            console.error(errorMsg)

            // Spezielle Behandlung für häufige Fehler
            let userMessage = errorMsg
            if (err.message.includes('121')) {
              userMessage = `Port-Timeout (Error 121): ${portPath}\n\nMögliche Ursachen:\n- Port wird bereits von einer anderen Anwendung verwendet\n- Bluetooth SPP-Treiber ist nicht bereit\n- Gerät ist nicht korrekt gepairt`
            } else if (err.message.includes('Access denied') || err.message.includes('5')) {
              userMessage = `Zugriff verweigert (Error 5): ${portPath}\n\nPort wird bereits verwendet. Bitte andere Anwendungen schließen.`
            } else if (err.message.includes('cannot open')) {
              userMessage = `Port kann nicht geöffnet werden: ${portPath}\n\nBitte überprüfen Sie:\n- Ist das Gerät eingeschaltet?\n- Ist das Gerät per Bluetooth verbunden?\n- Verwenden Sie den richtigen COM-Port?`
            }

            this.isConnected = false
            this.port = null
            this.emit('error', { message: userMessage, originalError: err })
            resolve(false)
          }
        })
      })
    } catch (error) {
      console.error('Verbindungsfehler:', error)
      return false
    }
  }

  /**
   * Trennt die Verbindung zum BLS Sensor
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port) {
        this.isConnected = false
        resolve()
        return
      }

      // Debug-Emitter stoppen
      this.stopDebugEmitter()

      // Entferne alle Listener um Memory Leaks zu vermeiden
      if (this.parser) {
        this.parser.removeAllListeners()
        this.parser = null
      }
      this.port.removeAllListeners()

      if (this.port.isOpen) {
        this.port.close((err) => {
          if (err) {
            console.error('Fehler beim Schließen des Ports:', err.message)
          }
          this.isConnected = false
          this.port = null
          this.resetSmoothing()
          this.emit('disconnected')
          console.log('Port geschlossen')
          resolve()
        })
      } else {
        this.isConnected = false
        this.port = null
        this.resetSmoothing()
        resolve()
      }
    })
  }

  /**
   * Setzt alle Glättungswerte zurück (bei Disconnect)
   */
  private resetSmoothing(): void {
    this.smoothedVariometer = 0
    this.smoothedSpeed = 0
    this.lastAltitude = 0
    this.lastAltitudeTime = 0
    this.lastValidSpeed = 0
    this.lastValidHeading = 0
    this.hasValidHeading = false
  }

  /**
   * Startet periodisches Senden der Debug-Statistiken
   */
  private startDebugEmitter(): void {
    this.stopDebugEmitter()
    this.debugInterval = setInterval(() => {
      this.emit('debug', this.getDebugStats())
    }, 500)
  }

  private stopDebugEmitter(): void {
    if (this.debugInterval) {
      clearInterval(this.debugInterval)
      this.debugInterval = null
    }
  }

  /**
   * Gibt aktuelle Debug-Statistiken zurück
   */
  getDebugStats() {
    const uptime = this.debugStats.connectedSince
      ? Math.round((Date.now() - this.debugStats.connectedSince) / 1000)
      : 0
    return {
      ...this.debugStats,
      uptime,
      qnh: this.lastQNH,
      isConnected: this.isConnected,
      rawLog: [...this.rawLog],  // Kopie der letzten NMEA Sätze
    }
  }

  /**
   * Cleanup - muss beim Beenden der App aufgerufen werden
   */
  async cleanup(): Promise<void> {
    console.log('BluetoothManager cleanup...')
    await this.disconnect()
  }

  /**
   * Konfiguriert das BLS Gerät für optimale Übertragung
   */
  private configureDevice(): void {
    if (!this.port?.isOpen) return

    // Flytec/Brauniger spezifische Befehle für höhere Update-Rate
    // PFLAC = Flarm/Flytec Konfiguration
    // Setze NMEA Output Rate auf 5 Hz (200ms Intervall)
    const commands = [
      // Aktiviere nur benötigte NMEA Sätze mit höherer Rate
      '$PFLAC,S,NMEAOUT,5*', // 5 Hz Update Rate
      '$PFLAC,R,QNH*',       // QNH-Wert abfragen
      '$PFLAC,R,BARO*',      // Barometer-Einstellung abfragen
    ]

    commands.forEach(cmd => {
      const checksum = this.calculateChecksum(cmd.slice(1, -1))
      const fullCmd = `${cmd.slice(0, -1)}${checksum}\r\n`
      try {
        this.port?.write(fullCmd)
        console.log('Sent config:', fullCmd.trim())
      } catch (err) {
        // Ignoriere Fehler - nicht alle Geräte unterstützen diese Befehle
      }
    })
  }

  /**
   * Exponential Moving Average (EMA) Glättung
   * @param current Aktueller geglätteter Wert
   * @param newValue Neuer Messwert
   * @param alpha Glättungsfaktor (0-1, niedriger = mehr Glättung)
   */
  private ema(current: number, newValue: number, alpha: number): number {
    if (current === 0) return newValue // Erster Wert
    return alpha * newValue + (1 - alpha) * current
  }

  /**
   * Berechnet NMEA Checksumme
   */
  private calculateChecksum(data: string): string {
    let checksum = 0
    for (let i = 0; i < data.length; i++) {
      checksum ^= data.charCodeAt(i)
    }
    return checksum.toString(16).toUpperCase().padStart(2, '0')
  }

  /**
   * Registriert einen Callback für GPS Daten
   */
  onGPSData(callback: (data: GPSData) => void): void {
    this.gpsCallbacks.push(callback)
  }

  /**
   * Registriert einen Callback für Barometer Daten
   */
  onBaroData(callback: (data: BaroData) => void): void {
    this.baroCallbacks.push(callback)
  }

  /**
   * Verarbeitet eingehende NMEA Daten
   */
  private processNMEAData(data: string): void {
    this.buffer += data

    // NMEA Sätze enden mit \r\n
    const lines = this.buffer.split('\r\n')
    this.buffer = lines.pop() || '' // Behalte unvollständige Zeile im Buffer

    for (const line of lines) {
      if (line.startsWith('$')) {
        this.parseNMEASentence(line)
      }
    }
  }

  /**
   * Parst einen einzelnen NMEA Satz
   */
  private parseNMEASentence(sentence: string): void {
    // Raw-Log: Jeden empfangenen Satz speichern (auch vor Checksum-Check)
    const ts = new Date().toISOString().substring(11, 23) // HH:mm:ss.SSS
    this.rawLog.push(`[${ts}] ${sentence}`)
    if (this.rawLog.length > this.RAW_LOG_MAX) {
      this.rawLog.splice(0, this.rawLog.length - this.RAW_LOG_MAX)
    }

    // Prüfe Checksumme
    if (!this.verifyChecksum(sentence)) {
      this.debugStats.checksumErrors++
      return
    }

    const parts = sentence.split(',')
    const type = parts[0]
    this.debugStats.lastSentence = type

    switch (type) {
      case '$GPGGA':
      case '$GNGGA':
        this.debugStats.ggaCount++
        // GGA-Timing für Intervall-Berechnung
        const now = Date.now()
        if (this.debugStats.lastGGATime > 0) {
          const interval = now - this.debugStats.lastGGATime
          // EMA für Durchschnitts-Intervall
          this.debugStats.avgGGAInterval = this.debugStats.avgGGAInterval === 0
            ? interval
            : this.debugStats.avgGGAInterval * 0.8 + interval * 0.2
        }
        this.debugStats.lastGGATime = now
        this.parseGGA(parts)
        break
      case '$GPRMC':
      case '$GNRMC':
        this.debugStats.rmcCount++
        this.parseRMC(parts)
        break
      case '$PGRMZ': // Garmin Altitude (von manchen Geräten)
        this.parsePGRMZ(parts)
        break
      case '$PFLAU': // Flarm/Flytec spezifisch
        this.parsePFLAU(parts)
        break
      case '$PFLAA': // Flarm Traffic
        break
      case '$PFLAC': // Flytec/Brauniger Konfiguration (enthält QNH)
        this.parsePFLAC(parts)
        break
      case '$LXWPx': // LX Navigation Variometer
        this.parseLXWP(parts)
        break
      default:
        // LXWP0, LXWP1 etc. separat prüfen
        if (type.startsWith('$LXWP')) {
          this.parseLXWP(parts)
        }
        break
    }
  }

  /**
   * Parst GGA Satz (GPS Fix, Altitude)
   */
  private parseGGA(parts: string[]): void {
    if (parts.length < 15) return

    const time = this.parseNMEATime(parts[1])
    const lat = this.parseNMEACoord(parts[2], parts[3])
    const lon = this.parseNMEACoord(parts[4], parts[5])
    const quality = parseInt(parts[6]) || 0
    const satellites = parseInt(parts[7]) || 0
    const hdop = parseFloat(parts[8]) || 99
    const altitude = parseFloat(parts[9]) || 0

    if (quality > 0 && lat !== null && lon !== null) {
      // WICHTIG: GGA enthält KEIN Speed/Heading!
      // Verwende den letzten gültigen Wert aus RMC, sonst springt der Marker nach Norden (0°)
      const gpsData: GPSData = {
        latitude: lat,
        longitude: lon,
        altitude: altitude,
        speed: this.lastValidSpeed,
        heading: this.lastValidHeading,
        timestamp: time,
        satellites: satellites,
        hdop: hdop
      }

      // Berechne Variometer aus Höhenänderung
      const now = Date.now()
      if (this.lastAltitudeTime > 0) {
        const dt = (now - this.lastAltitudeTime) / 1000 // Sekunden
        if (dt > 0 && dt < 5) {
          const rawVariometer = (altitude - this.lastAltitude) / dt

          // Glättung anwenden - stabilisiert die Anzeige
          this.smoothedVariometer = this.ema(this.smoothedVariometer, rawVariometer, this.VARIO_SMOOTHING)

          const baroData: BaroData = {
            pressureAltitude: altitude,
            qnh: this.lastQNH,
            variometer: this.smoothedVariometer,
            timestamp: time
          }

          this.baroCallbacks.forEach(cb => cb(baroData))
        }
      }
      this.lastAltitude = altitude
      this.lastAltitudeTime = now

      this.gpsCallbacks.forEach(cb => cb(gpsData))
    }
  }

  /**
   * Parst RMC Satz (Speed, Heading)
   */
  private parseRMC(parts: string[]): void {
    if (parts.length < 12) return

    // Status prüfen: A = Active (gültig), V = Void (ungültig)
    const status = parts[2]
    if (status !== 'A') return

    const rawSpeed = parseFloat(parts[7]) || 0 // Knoten
    const rawSpeedKmh = rawSpeed * 1.852

    // Speed glätten (für Anzeige in StatusBar)
    this.smoothedSpeed = this.ema(this.smoothedSpeed, rawSpeedKmh, this.SPEED_SMOOTHING)
    this.lastValidSpeed = this.smoothedSpeed

    // Heading: RAW-Wert direkt übernehmen (KEINE EMA-Glättung!)
    // Die Glättung erfolgt im MapView über "Render In The Past" (60fps Interpolation).
    // EMA auf Heading verursacht Verzögerung und doppelte Glättung.
    const headingField = parts[8]?.trim()
    const rawHeading = parseFloat(headingField)
    const hasHeadingData = headingField !== '' && !isNaN(rawHeading)

    if (hasHeadingData && rawSpeedKmh > 1.0) {
      this.lastValidHeading = rawHeading
      this.hasValidHeading = true
    }
    // Bei leerem Heading oder Stillstand: lastValidHeading bleibt unverändert

    // RMC aktualisiert NUR Speed/Heading - Position kommt ausschließlich aus GGA
    // Verhindert doppelte GPS-Callbacks (GGA + RMC) die den Marker zum Springen bringen
  }

  /**
   * Parst PGRMZ Satz (Altitude in feet)
   */
  private parsePGRMZ(parts: string[]): void {
    if (parts.length < 3) return
    this.debugStats.baroCount++

    const altitudeFeet = parseFloat(parts[1]) || 0
    const altitudeMeters = altitudeFeet * 0.3048

    const baroData: BaroData = {
      pressureAltitude: altitudeMeters,
      qnh: this.lastQNH,
      variometer: 0,
      timestamp: new Date()
    }

    this.baroCallbacks.forEach(cb => cb(baroData))
  }

  /**
   * Parst PFLAU Satz (Flarm Status)
   */
  private parsePFLAU(parts: string[]): void {
    // PFLAU enthält Flarm Statusinformationen
    // Kann für zukünftige Erweiterungen genutzt werden
  }

  /**
   * Parst PFLAC Sätze (Flytec/Brauniger Konfiguration)
   * Enthält unter anderem QNH: $PFLAC,A,BARO,1013.25*XX
   * oder: $PFLAC,S,QNH,1013.25*XX
   */
  private parsePFLAC(parts: string[]): void {
    if (parts.length < 4) return

    const key = parts[2]?.toUpperCase()
    const value = parts[3]

    // QNH kann in verschiedenen Feldern kommen
    if (key === 'QNH' || key === 'BARO' || key === 'QNE') {
      // Wert kann Checksumme enthalten: "1013.25*4A" → nur Zahl extrahieren
      const numStr = value?.split('*')[0]
      const qnh = parseFloat(numStr)
      if (!isNaN(qnh) && qnh > 900 && qnh < 1100) {
        this.lastQNH = qnh
        console.log(`[BLS] QNH empfangen: ${qnh} hPa`)
      }
    }
  }

  /**
   * Parst LX Navigation Variometer Sätze
   */
  private parseLXWP(parts: string[]): void {
    // LX Variometer Protokoll
    if (parts[0] === '$LXWP0' && parts.length >= 6) {
      const rawVariometer = parseFloat(parts[5]) || 0

      // Glättung anwenden
      this.smoothedVariometer = this.ema(this.smoothedVariometer, rawVariometer, this.VARIO_SMOOTHING)

      const baroData: BaroData = {
        pressureAltitude: this.lastAltitude,
        qnh: this.lastQNH,
        variometer: this.smoothedVariometer,
        timestamp: new Date()
      }

      this.baroCallbacks.forEach(cb => cb(baroData))
    }
  }

  /**
   * Konvertiert NMEA Zeit zu Date
   */
  private parseNMEATime(timeStr: string): Date {
    if (!timeStr || timeStr.length < 6) return new Date()

    const hours = parseInt(timeStr.substring(0, 2))
    const minutes = parseInt(timeStr.substring(2, 4))
    const seconds = parseFloat(timeStr.substring(4))

    const now = new Date()
    now.setUTCHours(hours, minutes, Math.floor(seconds), (seconds % 1) * 1000)
    return now
  }

  /**
   * Konvertiert NMEA Koordinaten zu Dezimalgrad
   */
  private parseNMEACoord(coord: string, direction: string): number | null {
    if (!coord || !direction) return null

    // NMEA Format: DDDMM.MMMM oder DDMM.MMMM
    const isLongitude = coord.length > 9
    const degreeDigits = isLongitude ? 3 : 2

    const degrees = parseInt(coord.substring(0, degreeDigits))
    const minutes = parseFloat(coord.substring(degreeDigits))

    let decimal = degrees + minutes / 60

    if (direction === 'S' || direction === 'W') {
      decimal = -decimal
    }

    return decimal
  }

  /**
   * Verifiziert die NMEA Checksumme
   */
  private verifyChecksum(sentence: string): boolean {
    const asteriskIndex = sentence.indexOf('*')
    if (asteriskIndex === -1) return false

    const data = sentence.substring(1, asteriskIndex) // Ohne $ und Checksumme
    const checksum = parseInt(sentence.substring(asteriskIndex + 1), 16)

    let calculated = 0
    for (let i = 0; i < data.length; i++) {
      calculated ^= data.charCodeAt(i)
    }

    return calculated === checksum
  }

  /**
   * Gibt den Verbindungsstatus zurück
   */
  getConnectionStatus(): boolean {
    return this.isConnected
  }
}
