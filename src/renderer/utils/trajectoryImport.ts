import { ImportedTrajectory, TrajectoryPoint } from '../../shared/types'

// 12 distinct colors for trajectory lines
export const TRAJECTORY_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
  '#00bcd4', '#8bc34a', '#ff9800', '#607d8b'
] as const

export type TrajectoryFormat = 'gpx' | 'kml' | 'unknown'

export interface TrajectoryImportResult {
  success: boolean
  format: TrajectoryFormat
  trajectories: ImportedTrajectory[]
  errors: string[]
  warnings: string[]
}

// Format erkennen
export function detectTrajectoryFormat(content: string): TrajectoryFormat {
  const trimmed = content.trim()
  if (trimmed.includes('<gpx') || trimmed.includes('<trk>') || trimmed.includes('<trkseg>')) {
    return 'gpx'
  }
  if (trimmed.includes('<kml') || trimmed.includes('<Placemark>') || trimmed.includes('<Placemark ') || trimmed.includes('<LineString>')) {
    return 'kml'
  }
  return 'unknown'
}

// ISA Druckstufen -> Hoehe in Metern (Windy.com Werte)
const PRESSURE_TO_ALTITUDE_M: Record<number, number> = {
  1013: 0,      // surface
  975: 100,     // 330ft
  950: 600,     // 2000ft
  925: 750,     // 2500ft
  900: 900,     // 3000ft
  850: 1500,    // 5000ft
  800: 2000,    // 6400ft
  700: 3000,    // 100FL
  600: 4200,    // 140FL
  500: 5500,    // 180FL
  400: 7200,    // 240FL
  300: 9000,    // 300FL
  250: 10400,   // 340FL
  200: 11700,   // 390FL
  150: 13500,   // 450FL
}

// hPa-Wert zu Hoehe in Metern konvertieren (Interpolation fuer unbekannte Werte)
function hpaToAltitudeMeters(hpa: number): number {
  // Exakter Treffer
  if (PRESSURE_TO_ALTITUDE_M[hpa] !== undefined) {
    return PRESSURE_TO_ALTITUDE_M[hpa]
  }
  // Interpolation zwischen bekannten Stufen
  const levels = Object.keys(PRESSURE_TO_ALTITUDE_M).map(Number).sort((a, b) => b - a) // absteigend (hoch->niedrig hPa)
  for (let i = 0; i < levels.length - 1; i++) {
    if (hpa <= levels[i] && hpa >= levels[i + 1]) {
      const upperHpa = levels[i], lowerHpa = levels[i + 1]
      const upperAlt = PRESSURE_TO_ALTITUDE_M[upperHpa]
      const lowerAlt = PRESSURE_TO_ALTITUDE_M[lowerHpa]
      const ratio = (upperHpa - hpa) / (upperHpa - lowerHpa)
      return Math.round(upperAlt + ratio * (lowerAlt - upperAlt))
    }
  }
  return 0
}

// hPa-Druckwert aus dem Trajektorie-Namen extrahieren
// Windy.com benennt Trajektorien z.B. "950h", "850h", "700h" etc.
function extractHpaFromName(name: string): number | null {
  // Match: Zahl gefolgt von "h" (case insensitive), z.B. "950h", "850H"
  // Auch in laengeren Namen wie "Trajectory - 950h - ECMWF"
  const match = name.match(/(\d{3,4})h\b/i)
  if (!match) return null
  const hpa = parseInt(match[1], 10)
  // Nur gueltige Druckwerte (100-1013 hPa)
  if (hpa >= 100 && hpa <= 1013) return hpa
  return null
}

// Hoehenlevel berechnen: Wenn Name einen hPa-Wert enthaelt (Windy),
// wird die ISA-Lookup-Tabelle verwendet. Sonst Median der Punkt-Hoehen.
function computeAltitudeLevel(name: string, points: TrajectoryPoint[]): number | undefined {
  // 1. Versuche hPa aus dem Namen zu extrahieren (Windy-Format)
  const hpa = extractHpaFromName(name)
  if (hpa !== null) {
    return hpaToAltitudeMeters(hpa)
  }

  // 2. Fallback: Median der Hoehenwerte aus den Punkten
  const alts = points.map(p => p.altitude).filter(a => a > 0)
  if (alts.length === 0) return undefined
  alts.sort((a, b) => a - b)
  const mid = Math.floor(alts.length / 2)
  const median = alts.length % 2 === 0 ? (alts[mid - 1] + alts[mid]) / 2 : alts[mid]
  return Math.round(median)
}

// Haupt-Parser
export function parseTrajectoryFile(content: string, filename: string): TrajectoryImportResult {
  const format = detectTrajectoryFormat(content)

  switch (format) {
    case 'gpx':
      return parseGPX(content, filename)
    case 'kml':
      return parseKML(content, filename)
    default:
      return {
        success: false,
        format: 'unknown',
        trajectories: [],
        errors: ['Unbekanntes Dateiformat. Nur GPX und KML werden unterstuetzt.'],
        warnings: []
      }
  }
}

// GPX Parser
function parseGPX(content: string, filename: string): TrajectoryImportResult {
  const result: TrajectoryImportResult = {
    success: false,
    format: 'gpx',
    trajectories: [],
    errors: [],
    warnings: []
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(content, 'text/xml')

    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      result.errors.push('GPX-Datei konnte nicht gelesen werden (XML-Fehler)')
      return result
    }

    const tracks = doc.querySelectorAll('trk')
    if (tracks.length === 0) {
      result.errors.push('Keine Tracks (<trk>) in der GPX-Datei gefunden')
      return result
    }

    let colorIndex = 0

    for (let t = 0; t < tracks.length; t++) {
      const trk = tracks[t]
      const nameEl = trk.querySelector('name')
      const name = nameEl?.textContent?.trim() || `Track ${t + 1}`

      const segments = trk.querySelectorAll('trkseg')
      const points: TrajectoryPoint[] = []

      for (let s = 0; s < segments.length; s++) {
        const trkpts = segments[s].querySelectorAll('trkpt')
        for (let p = 0; p < trkpts.length; p++) {
          const pt = trkpts[p]
          const lat = parseFloat(pt.getAttribute('lat') || '')
          const lon = parseFloat(pt.getAttribute('lon') || '')

          if (isNaN(lat) || isNaN(lon)) continue

          const eleEl = pt.querySelector('ele')
          const altitude = eleEl ? parseFloat(eleEl.textContent || '0') : 0

          const timeEl = pt.querySelector('time')
          let timestamp: Date | undefined
          if (timeEl?.textContent) {
            const d = new Date(timeEl.textContent)
            if (!isNaN(d.getTime())) timestamp = d
          }

          points.push({
            latitude: lat,
            longitude: lon,
            altitude: isNaN(altitude) ? 0 : altitude,
            timestamp
          })
        }
      }

      if (points.length > 1) {
        result.trajectories.push({
          id: crypto.randomUUID(),
          name,
          points,
          color: TRAJECTORY_COLORS[colorIndex % TRAJECTORY_COLORS.length],
          visible: true,
          sourceFile: filename,
          sourceFormat: 'gpx',
          altitudeLevel: computeAltitudeLevel(name, points)
        })
        colorIndex++
      } else if (points.length === 1) {
        result.warnings.push(`Track "${name}" hat nur 1 Punkt (uebersprungen)`)
      } else {
        result.warnings.push(`Track "${name}" hat keine gueltigen Punkte`)
      }
    }

    result.success = result.trajectories.length > 0
    if (result.trajectories.length === 0 && result.errors.length === 0) {
      result.errors.push('Keine Trajektorien mit gueltigen Punkten gefunden')
    }
  } catch (e: any) {
    result.errors.push(`GPX-Fehler: ${e.message}`)
  }

  return result
}

// KML Parser
function parseKML(content: string, filename: string): TrajectoryImportResult {
  const result: TrajectoryImportResult = {
    success: false,
    format: 'kml',
    trajectories: [],
    errors: [],
    warnings: []
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(content, 'text/xml')

    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      result.errors.push('KML-Datei konnte nicht gelesen werden (XML-Fehler)')
      return result
    }

    const placemarks = doc.querySelectorAll('Placemark')
    if (placemarks.length === 0) {
      result.errors.push('Keine Placemarks in der KML-Datei gefunden')
      return result
    }

    let colorIndex = 0

    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i]
      const nameEl = pm.querySelector('name')
      const name = nameEl?.textContent?.trim() || `Trajectory ${i + 1}`

      const lineString = pm.querySelector('LineString')
      if (!lineString) continue // Ueberspringen (z.B. Punkt-Marker)

      const coordsEl = lineString.querySelector('coordinates')
      if (!coordsEl?.textContent) {
        result.warnings.push(`Placemark "${name}" hat keine Koordinaten`)
        continue
      }

      const coordsText = coordsEl.textContent.trim()
      const points: TrajectoryPoint[] = []

      // KML coordinates: "lon,lat,alt lon,lat,alt ..." (Whitespace oder Newline getrennt)
      // WICHTIG: KML nutzt lon,lat,alt Reihenfolge (Laenge zuerst!)
      const coordPairs = coordsText.split(/\s+/).filter(s => s.trim())

      for (const pair of coordPairs) {
        const parts = pair.split(',')
        if (parts.length < 2) continue

        const lon = parseFloat(parts[0])
        const lat = parseFloat(parts[1])
        const alt = parts.length >= 3 ? parseFloat(parts[2]) : 0

        if (isNaN(lat) || isNaN(lon)) continue

        points.push({
          latitude: lat,
          longitude: lon,
          altitude: isNaN(alt) ? 0 : alt
        })
      }

      if (points.length > 1) {
        result.trajectories.push({
          id: crypto.randomUUID(),
          name,
          points,
          color: TRAJECTORY_COLORS[colorIndex % TRAJECTORY_COLORS.length],
          visible: true,
          sourceFile: filename,
          sourceFormat: 'kml',
          altitudeLevel: computeAltitudeLevel(name, points)
        })
        colorIndex++
      } else if (points.length === 1) {
        result.warnings.push(`Placemark "${name}" hat nur 1 Punkt (uebersprungen)`)
      }
    }

    result.success = result.trajectories.length > 0
    if (result.trajectories.length === 0 && result.errors.length === 0) {
      result.errors.push('Keine Trajektorien mit Linien-Daten gefunden')
    }
  } catch (e: any) {
    result.errors.push(`KML-Fehler: ${e.message}`)
  }

  return result
}

// Format-Name fuer UI
export function trajectoryFormatName(format: TrajectoryFormat): string {
  switch (format) {
    case 'gpx': return 'GPX'
    case 'kml': return 'KML'
    default: return 'Unbekannt'
  }
}
