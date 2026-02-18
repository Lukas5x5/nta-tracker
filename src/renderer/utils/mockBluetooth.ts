/**
 * Mock Bluetooth API für Entwicklung im Browser
 * Simuliert den BLS Sensor wenn keine echte Electron-Umgebung verfügbar ist
 */

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

// Simulierte Flugdaten (Österreich - Wachau Region)
let simulationActive = false
let currentLat = 48.3833 // Krems an der Donau
let currentLon = 15.6167
let currentAlt = 450
let currentHeading = 45
let currentSpeed = 15
let gpsCallback: ((data: GPSData) => void) | null = null
let baroCallback: ((data: BaroData) => void) | null = null
let simulationInterval: number | null = null

function startSimulation() {
  if (simulationInterval) return

  simulationActive = true

  simulationInterval = window.setInterval(() => {
    // Simuliere Ballonbewegung
    const windDirection = 225 // SW Wind
    const windSpeed = 0.00005 // Bewegung pro Tick

    // Leichte Zufallsbewegung
    currentLat += Math.cos((windDirection * Math.PI) / 180) * windSpeed + (Math.random() - 0.5) * 0.00001
    currentLon += Math.sin((windDirection * Math.PI) / 180) * windSpeed + (Math.random() - 0.5) * 0.00001

    // Höhenänderung (thermische Aktivität simulieren)
    const vario = (Math.random() - 0.4) * 2 // -0.8 bis +1.2 m/s
    currentAlt += vario

    // Heading langsam ändern
    currentHeading = (currentHeading + (Math.random() - 0.5) * 5 + 360) % 360

    // Speed variieren
    currentSpeed = 10 + Math.random() * 10

    const gpsData: GPSData = {
      latitude: currentLat,
      longitude: currentLon,
      altitude: currentAlt,
      speed: currentSpeed,
      heading: currentHeading,
      timestamp: new Date(),
      satellites: 8 + Math.floor(Math.random() * 5),
      hdop: 0.8 + Math.random() * 0.5
    }

    const baroData: BaroData = {
      pressureAltitude: currentAlt + (Math.random() - 0.5) * 2,
      qnh: 1013.25,
      variometer: vario,
      timestamp: new Date()
    }

    if (gpsCallback) gpsCallback(gpsData)
    if (baroCallback) baroCallback(baroData)
  }, 200) // 5 Hz wie der echte BLS
}

function stopSimulation() {
  simulationActive = false
  if (simulationInterval) {
    clearInterval(simulationInterval)
    simulationInterval = null
  }
}

// Mock API die die echte ntaAPI ersetzt
export const mockNtaAPI = {
  bluetooth: {
    scan: async (): Promise<BluetoothDevice[]> => {
      // Simuliere Scan-Verzögerung
      await new Promise(resolve => setTimeout(resolve, 1500))

      return [
        {
          id: 'BLS-MOCK-001',
          name: 'Balloon Live Sensor (Simulation)',
          rssi: -65
        },
        {
          id: 'BLS-MOCK-002',
          name: 'Flytec BLS Demo',
          rssi: -72
        }
      ]
    },

    connect: async (deviceId: string): Promise<boolean> => {
      console.log('Mock: Connecting to', deviceId)
      await new Promise(resolve => setTimeout(resolve, 1000))
      startSimulation()
      return true
    },

    disconnect: async (): Promise<void> => {
      console.log('Mock: Disconnecting')
      stopSimulation()
    }
  },

  gps: {
    subscribe: (callback: (data: GPSData) => void) => {
      gpsCallback = callback
      if (simulationActive && !simulationInterval) {
        startSimulation()
      }
    },
    unsubscribe: () => {
      gpsCallback = null
    }
  },

  baro: {
    subscribe: (callback: (data: BaroData) => void) => {
      baroCallback = callback
      if (simulationActive && !simulationInterval) {
        startSimulation()
      }
    },
    unsubscribe: () => {
      baroCallback = null
    }
  },

  files: {
    saveIGC: async (data: string, filename: string): Promise<string> => {
      // Im Browser: Download als Datei
      const blob = new Blob([data], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      return filename
    },
    loadWaypoints: async (): Promise<any[]> => [],
    saveFlightReport: async (report: any): Promise<string> => {
      console.log('Mock: Saving flight report', report)
      return 'report.txt'
    }
  },

  maps: {
    import: async () => {
      console.log('Mock: Map import not available in browser mode')
      return null
    },
    importWithImage: async () => {
      console.log('Mock: Map import not available in browser mode')
      return null
    },
    list: async () => [],
    remove: async () => false,
    getCalibration: async () => null,
    getImagePath: async () => '',
    getImageDataUrl: async () => '',
    geoToPixel: async () => null,
    pixelToGeo: async () => null,
    findForLocation: async () => [],
    selectFiles: async () => null,
    updateCalibration: async () => false
  },

  tiles: {
    has: async () => false,
    get: async () => null,
    saveTile: async () => false,
    getStats: async () => ({ totalTiles: 0, totalSize: 0, providers: {} }),
    clear: async () => true,
    getCacheDir: async () => ''
  },

  elevation: {
    getElevation: async () => null,
    getElevations: async () => [],
    import: async () => null,
    status: async () => ({ tiles: [], hgtDir: '' })
  },

  openExternal: async (url: string) => {
    window.open(url, '_blank')
  }
}

// Installiere Mock API wenn nicht in Electron
export function installMockAPI() {
  if (typeof window !== 'undefined' && !(window as any).ntaAPI) {
    console.log('NTA: Browser-Modus - Verwende simulierte BLS Daten')
    ;(window as any).ntaAPI = mockNtaAPI
  } else {
    console.log('NTA: Electron-Modus - Verwende echte Hardware-Anbindung')
  }
}
