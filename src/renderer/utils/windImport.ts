import { WindLayer, WindSource } from '../../shared/types'

// Import-Konfiguration
export interface WindImportSettings {
  altitudeUnit: 'meters' | 'feet'
  speedUnit: 'kmh' | 'ms' | 'knots'
  directionMode: 'from' | 'to'
  directionReference: 'true' | 'magnetic'
  altitudeReference: 'msl' | 'agl'
  launchElevation: number
  magneticDeclination: number
  layerThicknessFt?: number // Schichtdicke-Filter in Feet (z.B. 100, 200, 500). undefined = alle Schichten behalten
}

// Geparste Zeile vor Normalisierung
export interface ParsedWindRow {
  altitude: number
  direction: number
  speed: number
}

// Erkanntes Format
export type DetectedFormat = 'oziTargetXml' | 'windsondDat' | 'csv' | 'unknown'

// Parse-Ergebnis
export interface WindImportResult {
  success: boolean
  format: DetectedFormat
  rows: ParsedWindRow[]
  detectedSettings?: Partial<WindImportSettings>
  errors: string[]
  warnings: string[]
}

// Standard-Einstellungen
export const defaultImportSettings: WindImportSettings = {
  altitudeUnit: 'meters',
  speedUnit: 'kmh',
  directionMode: 'from',
  directionReference: 'true',
  altitudeReference: 'msl',
  launchElevation: 0,
  magneticDeclination: 0
}

// Format erkennen
export function detectFormat(content: string): DetectedFormat {
  const trimmed = content.trim()
  if (trimmed.includes('<wR>') || trimmed.includes('<wRs>') || trimmed.includes('<wR ')) {
    return 'oziTargetXml'
  }
  // Pruefen ob Zeilen Kommas enthalten (CSV)
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//'))
  if (lines.length > 0) {
    const dataLines = lines.filter(l => {
      const parts = l.split(',')
      return parts.length >= 3
    })
    if (dataLines.length > lines.length * 0.5) {
      return 'csv'
    }
  }
  // Whitespace-getrennt -> Windsond .dat
  if (lines.length > 0) {
    const dataLines = lines.filter(l => {
      const parts = l.trim().split(/\s+/)
      return parts.length >= 3 && parts.slice(0, 3).every(p => !isNaN(Number(p)))
    })
    if (dataLines.length > 0) {
      return 'windsondDat'
    }
  }
  return 'unknown'
}

// oziTarget XML parsen
export function parseOziTargetXml(content: string): WindImportResult {
  const result: WindImportResult = {
    success: false,
    format: 'oziTargetXml',
    rows: [],
    detectedSettings: {},
    errors: [],
    warnings: []
  }

  try {
    // XML muss ein Root-Element haben - wrappen falls keins vorhanden
    let xmlContent = content.trim()
    if (!xmlContent.startsWith('<?xml') && !xmlContent.match(/^<[a-zA-Z]+[^>]*>/)) {
      xmlContent = '<root>' + xmlContent + '</root>'
    } else if (!xmlContent.startsWith('<?xml') && !xmlContent.startsWith('<root')) {
      xmlContent = '<root>' + xmlContent + '</root>'
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, 'text/xml')

    // Parse-Fehler pruefen
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      // Fallback: manuell wrappen
      const wrappedDoc = parser.parseFromString('<root>' + content.trim() + '</root>', 'text/xml')
      const wrappedError = wrappedDoc.querySelector('parsererror')
      if (wrappedError) {
        result.errors.push('XML konnte nicht gelesen werden')
        return result
      }
      return parseOziTargetXmlDoc(wrappedDoc, result)
    }

    return parseOziTargetXmlDoc(doc, result)
  } catch (e: any) {
    result.errors.push(`XML-Fehler: ${e.message}`)
    return result
  }
}

function parseOziTargetXmlDoc(doc: Document, result: WindImportResult): WindImportResult {
  // Header-Metadaten lesen
  const wRs = doc.querySelector('wRs')
  if (wRs) {
    const spdUnits = wRs.querySelector('SpdUnits')?.textContent?.trim()
    if (spdUnits) {
      const map: Record<string, 'kmh' | 'ms' | 'knots'> = {
        'Km/h': 'kmh', 'km/h': 'kmh', 'KM/H': 'kmh',
        'M/s': 'ms', 'm/s': 'ms', 'M/S': 'ms',
        'Kts': 'knots', 'kts': 'knots', 'KTS': 'knots', 'Knots': 'knots', 'knots': 'knots'
      }
      if (map[spdUnits]) result.detectedSettings!.speedUnit = map[spdUnits]
    }

    const altUnits = wRs.querySelector('AltUnits')?.textContent?.trim()
    if (altUnits) {
      const map: Record<string, 'meters' | 'feet'> = {
        'Feet': 'feet', 'feet': 'feet', 'FEET': 'feet', 'ft': 'feet',
        'Meters': 'meters', 'meters': 'meters', 'METERS': 'meters', 'm': 'meters'
      }
      if (map[altUnits]) result.detectedSettings!.altitudeUnit = map[altUnits]
    }

    const dirToFrom = wRs.querySelector('DirToFrom')?.textContent?.trim()
    if (dirToFrom) {
      const map: Record<string, 'from' | 'to'> = {
        'From': 'from', 'from': 'from', 'FROM': 'from',
        'To': 'to', 'to': 'to', 'TO': 'to'
      }
      if (map[dirToFrom]) result.detectedSettings!.directionMode = map[dirToFrom]
    }

    const dirMagTrue = wRs.querySelector('DirMagTrue')?.textContent?.trim()
    if (dirMagTrue) {
      const map: Record<string, 'true' | 'magnetic'> = {
        'True': 'true', 'true': 'true', 'TRUE': 'true',
        'Magnetic': 'magnetic', 'magnetic': 'magnetic', 'MAGNETIC': 'magnetic', 'Mag': 'magnetic'
      }
      if (map[dirMagTrue]) result.detectedSettings!.directionReference = map[dirMagTrue]
    }

    const aglAmsl = wRs.querySelector('AglAmsl')?.textContent?.trim()
    if (aglAmsl) {
      const map: Record<string, 'msl' | 'agl'> = {
        'AMSL': 'msl', 'amsl': 'msl', 'MSL': 'msl',
        'AGL': 'agl', 'agl': 'agl'
      }
      if (map[aglAmsl]) result.detectedSettings!.altitudeReference = map[aglAmsl]
    }

    const elevation = wRs.querySelector('Elevation')?.textContent?.trim()
    if (elevation && !isNaN(Number(elevation))) {
      // Elevation ist in der gleichen Einheit wie AltUnits
      let elevM = Number(elevation)
      if (result.detectedSettings!.altitudeUnit === 'feet') {
        elevM = elevM * 0.3048
      }
      result.detectedSettings!.launchElevation = Math.round(elevM)
    }

    const magVar = wRs.querySelector('MagVariation')?.textContent?.trim()
    if (magVar && !isNaN(Number(magVar))) {
      result.detectedSettings!.magneticDeclination = Number(magVar)
    }
  }

  // Wind-Zeilen lesen
  const wRElements = doc.querySelectorAll('wR')
  for (let i = 0; i < wRElements.length; i++) {
    const text = wRElements[i].textContent?.trim()
    if (!text) continue

    const parts = text.split(/[\s,]+/).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(n => !isNaN(n))) {
      result.rows.push({
        altitude: parts[0],
        direction: parts[1],
        speed: parts[2]
      })
    } else {
      result.warnings.push(`wR Element ${i + 1} konnte nicht gelesen werden: "${text}"`)
    }
  }

  result.success = result.rows.length > 0
  if (result.rows.length === 0 && result.errors.length === 0) {
    result.errors.push('Keine Wind-Daten (wR Elemente) gefunden')
  }

  return result
}

// Einheiten aus Text-Header erkennen
function detectSettingsFromText(content: string): Partial<WindImportSettings> {
  const detected: Partial<WindImportSettings> = {}
  const lower = content.toLowerCase()

  // Höheneinheit erkennen
  if (/\balt(?:itude)?\s*\(?(?:ft|feet)\b/i.test(content) || /\bagl\s*\[ft\]/i.test(content) || /\[ft\]/i.test(content)) {
    detected.altitudeUnit = 'feet'
  } else if (/\balt(?:itude)?\s*\(?(?:m|meter|metres)\b/i.test(content) || /\bagl\s*\[m\]/i.test(content) || /\[m\]/i.test(content)) {
    detected.altitudeUnit = 'meters'
  }

  // Höhenbezug erkennen
  if (/\bagl\b/i.test(content)) {
    detected.altitudeReference = 'agl'
  } else if (/\b(?:amsl|msl)\b/i.test(content)) {
    detected.altitudeReference = 'msl'
  }

  // Ground Level / Launch Elevation erkennen
  const groundMatch = content.match(/ground\s*level[:\s]*([0-9.]+)\s*(ft|m)/i)
  if (groundMatch) {
    let elev = parseFloat(groundMatch[1])
    if (groundMatch[2].toLowerCase() === 'ft') elev = elev * 0.3048
    detected.launchElevation = Math.round(elev)
  }

  // Geschwindigkeitseinheit erkennen
  if (/\bspeed\s*\(?(?:km\/h|kmh|kph)\b/i.test(content) || /\[km\/h\]/i.test(content)) {
    detected.speedUnit = 'kmh'
  } else if (/\bspeed\s*\(?(?:m\/s|ms)\b/i.test(content) || /\[m\/s\]/i.test(content)) {
    detected.speedUnit = 'ms'
  } else if (/\bspeed\s*\(?(?:kts|knots|kt)\b/i.test(content) || /\[kts?\]/i.test(content)) {
    detected.speedUnit = 'knots'
  }

  // Richtungsreferenz erkennen
  if (/\b(?:true|true deg)\b/i.test(content)) {
    detected.directionReference = 'true'
  } else if (/\b(?:magnetic|mag)\b/i.test(content)) {
    detected.directionReference = 'magnetic'
  }

  // Richtungsmodus (heading = zu/to, wind direction = von/from)
  if (/\bheading\b/i.test(content)) {
    detected.directionMode = 'to'
  } else if (/\bwind\s*(?:dir|direction)\b/i.test(content)) {
    detected.directionMode = 'from'
  }

  return detected
}

// Text/DAT/CSV parsen
export function parseTextWindFile(content: string): WindImportResult {
  const result: WindImportResult = {
    success: false,
    format: 'windsondDat',
    rows: [],
    detectedSettings: {},
    errors: [],
    warnings: []
  }

  const lines = content.split(/\r?\n/)
  let hasCommas = false

  // Einheiten aus Header/Kommentaren erkennen (erste 10 Zeilen)
  const headerText = lines.slice(0, 10).join('\n')
  result.detectedSettings = detectSettingsFromText(headerText)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    // Separator erkennen
    const isCommaSeparated = line.includes(',')
    if (isCommaSeparated) hasCommas = true

    const separator = isCommaSeparated ? ',' : /\s+/
    const parts = line.split(separator).map(s => s.trim()).filter(Boolean)

    if (parts.length >= 3) {
      const nums = parts.slice(0, 3).map(Number)
      if (nums.every(n => !isNaN(n))) {
        result.rows.push({
          altitude: nums[0],
          direction: nums[1],
          speed: nums[2]
        })
      } else if (i === 0 || result.rows.length === 0) {
        // Erste Zeile mit nicht-numerischen Werten = Header
        result.warnings.push(`Zeile ${i + 1} uebersprungen (Header): "${line}"`)
      } else {
        result.warnings.push(`Zeile ${i + 1} konnte nicht gelesen werden: "${line}"`)
      }
    }
  }

  if (hasCommas) result.format = 'csv'
  result.success = result.rows.length > 0
  if (result.rows.length === 0 && result.errors.length === 0) {
    result.errors.push('Keine Wind-Daten gefunden')
  }

  return result
}

// Haupt-Parser: Format erkennen und dispatch
export function parseWindFile(content: string): WindImportResult {
  const format = detectFormat(content)

  switch (format) {
    case 'oziTargetXml':
      return parseOziTargetXml(content)
    case 'csv':
    case 'windsondDat':
      return parseTextWindFile(content)
    default:
      return {
        success: false,
        format: 'unknown',
        rows: [],
        errors: ['Unbekanntes Dateiformat'],
        warnings: []
      }
  }
}

// WindSource aus Format ableiten
export function inferWindSource(format: DetectedFormat, filename?: string): WindSource {
  if (filename) {
    const lower = filename.toLowerCase()
    if (lower.includes('windsond') || lower.includes('windwatch')) return WindSource.Windsond
    if (lower.includes('pibal')) return WindSource.Pibal
    if (lower.includes('forecast') || lower.includes('prognose')) return WindSource.Forecast
  }
  switch (format) {
    case 'oziTargetXml': return WindSource.Pibal
    case 'windsondDat': return WindSource.Windsond
    case 'csv': return WindSource.Pibal
    default: return WindSource.Manual
  }
}

// Zu internen Einheiten normalisieren (km/h, Meter MSL, VON/True)
export function normalizeToInternal(
  rows: ParsedWindRow[],
  settings: WindImportSettings,
  source: WindSource = WindSource.Pibal
): WindLayer[] {
  const layers: WindLayer[] = []
  const seenAltitudes = new Set<number>()

  for (const row of rows) {
    // Hoehe konvertieren
    let altMeters = settings.altitudeUnit === 'feet'
      ? row.altitude * 0.3048
      : row.altitude
    if (settings.altitudeReference === 'agl') {
      altMeters += settings.launchElevation
    }
    const roundedAlt = Math.round(altMeters)

    // Duplikate: letzte gewinnt
    if (seenAltitudes.has(roundedAlt)) {
      const idx = layers.findIndex(l => l.altitude === roundedAlt)
      if (idx >= 0) layers.splice(idx, 1)
    }
    seenAltitudes.add(roundedAlt)

    // Geschwindigkeit zu km/h
    let speedKmh: number
    switch (settings.speedUnit) {
      case 'ms': speedKmh = row.speed * 3.6; break
      case 'knots': speedKmh = row.speed * 1.852; break
      default: speedKmh = row.speed; break
    }

    // Richtung zu VON / True North
    let direction = row.direction
    if (settings.directionMode === 'to') {
      direction = (direction + 180) % 360
    }
    if (settings.directionReference === 'magnetic') {
      direction = (direction + settings.magneticDeclination + 360) % 360
    }

    layers.push({
      altitude: roundedAlt,
      direction: Math.round(direction) % 360,
      speed: Math.round(speedKmh * 10) / 10,
      timestamp: new Date(),
      source
    })
  }

  return layers.sort((a, b) => a.altitude - b.altitude)
}

// Format-Name fuer UI
export function formatName(format: DetectedFormat): string {
  switch (format) {
    case 'oziTargetXml': return 'oziTarget XML'
    case 'windsondDat': return 'Windsond/Text'
    case 'csv': return 'CSV'
    default: return 'Unbekannt'
  }
}

/**
 * Filtert Windschichten auf ein Höhenraster mit bestimmter Schichtdicke.
 * Für jeden Rasterpunkt wird die nächste Schicht innerhalb einer Toleranz behalten.
 * @param layers - Normalisierte Windschichten (Höhe in Metern MSL)
 * @param thicknessFt - Raster-Intervall in Feet (z.B. 100)
 * @returns Gefilterte Windschichten
 */
export function filterByLayerThickness(layers: WindLayer[], thicknessFt: number): WindLayer[] {
  if (!thicknessFt || thicknessFt <= 0 || layers.length === 0) return layers

  const thicknessM = thicknessFt * 0.3048
  const toleranceM = thicknessM * 0.4 // 40% Toleranz für Snap

  const minAlt = Math.min(...layers.map(l => l.altitude))
  const maxAlt = Math.max(...layers.map(l => l.altitude))

  // Raster-Startpunkt: niedrigster Vielfacher von thicknessM
  const gridStart = Math.floor(minAlt / thicknessM) * thicknessM

  const result: WindLayer[] = []
  const usedIndices = new Set<number>()

  for (let gridAlt = gridStart; gridAlt <= maxAlt + thicknessM; gridAlt += thicknessM) {
    let closestIdx = -1
    let closestDist = Infinity

    for (let i = 0; i < layers.length; i++) {
      if (usedIndices.has(i)) continue
      const dist = Math.abs(layers[i].altitude - gridAlt)
      if (dist < closestDist && dist <= toleranceM) {
        closestDist = dist
        closestIdx = i
      }
    }

    if (closestIdx >= 0) {
      result.push(layers[closestIdx])
      usedIndices.add(closestIdx)
    }
  }

  return result.sort((a, b) => a.altitude - b.altitude)
}
