import { WindLayer, WindSource } from '../../shared/types'

// Drucklevel für Ballonflug bis ~10.000ft (700hPa ≈ 3010m ≈ 9880ft)
const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700] as const

type PressureLevel = typeof PRESSURE_LEVELS[number]

// Verfügbare Wettermodelle
export interface WeatherModel {
  id: string
  name: string
  resolution: string
  coverage: string
}

export const WEATHER_MODELS: WeatherModel[] = [
  { id: 'icon_d2', name: 'ICON-D2', resolution: '2 km', coverage: 'Deutschland + Nachbarn' },
  { id: 'icon_eu', name: 'ICON-EU', resolution: '7 km', coverage: 'Europa' },
  { id: 'icon_global', name: 'ICON Global', resolution: '13 km', coverage: 'Weltweit' },
  { id: 'gfs025', name: 'GFS', resolution: '25 km', coverage: 'Weltweit' },
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS', resolution: '25 km', coverage: 'Weltweit' },
]

// Open-Meteo API Response
interface OpenMeteoResponse {
  latitude: number
  longitude: number
  elevation: number
  timezone: string
  hourly: {
    time: string[]
    [key: string]: number[] | string[]
  }
}

export interface IconD2Result {
  success: boolean
  layers: WindLayer[]
  modelTime: string // ISO timestamp des genutzten Modellzeitpunkts
  modelId: string // Welches Modell verwendet wurde
  location: { lat: number; lon: number }
  elevation: number
  errors: string[]
}

// Nächste volle Stunde finden (oder aktuelle wenn innerhalb 15 Min)
function findClosestHourIndex(times: string[], targetDate?: Date): number {
  const now = targetDate || new Date()
  let bestIdx = 0
  let bestDiff = Infinity

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i])
    const diff = Math.abs(t.getTime() - now.getTime())
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  return bestIdx
}

// Winddaten von Open-Meteo laden (beliebiges Modell)
export async function fetchIconD2Wind(
  lat: number,
  lon: number,
  targetDate?: Date,
  modelId: string = 'icon_d2'
): Promise<IconD2Result> {
  const result: IconD2Result = {
    success: false,
    layers: [],
    modelTime: '',
    modelId,
    location: { lat, lon },
    elevation: 0,
    errors: []
  }

  // Variablen für alle Drucklevel zusammenbauen
  const windSpeedVars = PRESSURE_LEVELS.map(p => `wind_speed_${p}hPa`)
  const windDirVars = PRESSURE_LEVELS.map(p => `wind_direction_${p}hPa`)
  const geoHeightVars = PRESSURE_LEVELS.map(p => `geopotential_height_${p}hPa`)
  const allVars = [...windSpeedVars, ...windDirVars, ...geoHeightVars].join(',')

  const url = `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${allVars}` +
    `&models=${modelId}` +
    `&wind_speed_unit=kmh` +
    `&forecast_days=2` +
    `&timezone=auto`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      result.errors.push(`API Fehler ${response.status}: ${text.slice(0, 200)}`)
      return result
    }

    const data: OpenMeteoResponse = await response.json()
    result.elevation = data.elevation
    result.location = { lat: data.latitude, lon: data.longitude }

    if (!data.hourly?.time || data.hourly.time.length === 0) {
      result.errors.push('Keine Zeitdaten in der API-Antwort')
      return result
    }

    // Nächsten Zeitpunkt finden
    const timeIdx = findClosestHourIndex(data.hourly.time, targetDate)
    result.modelTime = data.hourly.time[timeIdx]

    // Wind-Layer für jeden Drucklevel extrahieren
    for (const pressure of PRESSURE_LEVELS) {
      const speedKey = `wind_speed_${pressure}hPa`
      const dirKey = `wind_direction_${pressure}hPa`
      const heightKey = `geopotential_height_${pressure}hPa`

      const speedArr = data.hourly[speedKey] as number[] | undefined
      const dirArr = data.hourly[dirKey] as number[] | undefined
      const heightArr = data.hourly[heightKey] as number[] | undefined

      if (!speedArr || !dirArr || !heightArr) continue

      const speed = speedArr[timeIdx]
      const direction = dirArr[timeIdx]
      const geoHeight = heightArr[timeIdx]

      if (speed == null || direction == null || geoHeight == null) continue
      if (isNaN(speed) || isNaN(direction) || isNaN(geoHeight)) continue

      // Geopotentielle Höhe ≈ Meter MSL (gute Näherung für Troposphäre)
      const altitudeM = Math.round(geoHeight)

      result.layers.push({
        altitude: altitudeM,
        direction: Math.round(direction) % 360, // Windrichtung "woher"
        speed: Math.round(speed * 10) / 10, // km/h, 1 Dezimale
        timestamp: new Date(data.hourly.time[timeIdx]),
        source: WindSource.Forecast
      })
    }

    // Nur Schichten von Boden bis ~10.000ft MSL behalten
    const groundElev = data.elevation || 0
    const maxAltitude = groundElev + 3048 // 10.000ft über Grund
    result.layers = result.layers.filter(l => l.altitude >= groundElev && l.altitude <= maxAltitude)

    // Nach Höhe sortieren
    result.layers.sort((a, b) => a.altitude - b.altitude)
    result.success = result.layers.length > 0

    const modelName = WEATHER_MODELS.find(m => m.id === modelId)?.name || modelId
    if (result.layers.length === 0) {
      result.errors.push(`Keine Winddaten für diesen Standort verfügbar (außerhalb ${modelName} Gebiet?)`)
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      result.errors.push('Anfrage abgebrochen')
    } else if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      result.errors.push('Keine Internetverbindung')
    } else {
      result.errors.push(`Netzwerkfehler: ${err.message}`)
    }
  }

  return result
}

// Verfügbare Zeitpunkte aus Forecast abfragen (für Zeitauswahl)
export function getAvailableForecastTimes(hoursAhead: number = 48): Date[] {
  const times: Date[] = []
  const now = new Date()
  // Auf aktuelle Stunde abrunden
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())

  for (let h = 0; h <= hoursAhead; h++) {
    const t = new Date(start.getTime() + h * 3600000)
    times.push(t)
  }
  return times
}
