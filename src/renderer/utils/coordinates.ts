/**
 * Koordinaten-Konvertierung und UTM Support
 */

export type CoordinateFormat = 'decimal' | 'dms' | 'dm' | 'utm4' | 'utm5' | 'utm6' | 'utm7' | 'utm8'

interface UTMCoordinate {
  easting: number
  northing: number
  zone: number
  hemisphere: 'N' | 'S'
}

/**
 * WGS84 zu UTM Konvertierung
 */
export function latLonToUTM(lat: number, lon: number): UTMCoordinate {
  // UTM Zone berechnen
  let zone = Math.floor((lon + 180) / 6) + 1

  // Spezielle Zonen für Norwegen und Svalbard
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31
    else if (lon >= 9 && lon < 21) zone = 33
    else if (lon >= 21 && lon < 33) zone = 35
    else if (lon >= 33 && lon < 42) zone = 37
  }

  const hemisphere: 'N' | 'S' = lat >= 0 ? 'N' : 'S'

  // Konstanten
  const a = 6378137 // WGS84 major axis
  const f = 1 / 298.257223563 // WGS84 flattening
  const k0 = 0.9996 // UTM scale factor
  const e = Math.sqrt(2 * f - f * f) // eccentricity
  const e2 = e * e
  const ep2 = e2 / (1 - e2)

  const lonRad = (lon * Math.PI) / 180
  const latRad = (lat * Math.PI) / 180

  const lonOrigin = (zone - 1) * 6 - 180 + 3
  const lonOriginRad = (lonOrigin * Math.PI) / 180

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad))
  const T = Math.tan(latRad) * Math.tan(latRad)
  const C = ep2 * Math.cos(latRad) * Math.cos(latRad)
  const A = Math.cos(latRad) * (lonRad - lonOriginRad)

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad -
    (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad) +
    (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad) -
    (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad)
  )

  let easting = k0 * N * (
    A +
    (1 - T + C) * A * A * A / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A * A * A * A * A / 120
  ) + 500000

  let northing = k0 * (
    M +
    N * Math.tan(latRad) * (
      A * A / 2 +
      (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A * A * A * A * A * A / 720
    )
  )

  if (lat < 0) {
    northing += 10000000 // Southern hemisphere offset
  }

  return { easting, northing, zone, hemisphere }
}

/**
 * UTM zu WGS84 Konvertierung
 */
export function utmToLatLon(easting: number, northing: number, zone: number, hemisphere: 'N' | 'S'): { lat: number; lon: number } {
  const k0 = 0.9996
  const a = 6378137
  const f = 1 / 298.257223563
  const e = Math.sqrt(2 * f - f * f)
  const e2 = e * e
  const ep2 = e2 / (1 - e2)
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))

  const x = easting - 500000
  let y = northing

  if (hemisphere === 'S') {
    y -= 10000000
  }

  const lonOrigin = (zone - 1) * 6 - 180 + 3

  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256))

  const phi1Rad = mu +
    (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)

  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1Rad) * Math.sin(phi1Rad))
  const T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad)
  const C1 = ep2 * Math.cos(phi1Rad) * Math.cos(phi1Rad)
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5)
  const D = x / (N1 * k0)

  let lat = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (
    D * D / 2 -
    (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24 +
    (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720
  )

  let lon = (
    D -
    (1 + 2 * T1 + C1) * D * D * D / 6 +
    (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / Math.cos(phi1Rad)

  lat = (lat * 180) / Math.PI
  lon = lonOrigin + (lon * 180) / Math.PI

  return { lat, lon }
}

/**
 * Formatiert UTM Koordinaten als Grid Reference (FAI Balloon Competition Style)
 *
 * WICHTIG: Grid Reference zeigt nur Meter INNERHALB eines 100km Grid Squares
 *
 * Beispiele:
 * - Full UTM Easting 511025 → innerhalb 100km: 11025m → 4/4: "1102" (erste 4 Stellen = 10m Genauigkeit)
 * - Full UTM Northing 5330100 → innerhalb 100km: 30100m → 4/4: "3010" (erste 4 Stellen = 10m Genauigkeit)
 *
 * Regel:
 * 1. Berechne Position innerhalb des 100km Grid Squares (Modulo 100000)
 * 2. Zeige 'digits' Stellen dieser Position
 */
export function formatUTMGridRef(easting: number, northing: number, digits: 4 | 5 | 6 | 7 | 8): string {
  if (digits >= 7) {
    // 7-8 Stellen: volle Koordinaten
    const eastStr = Math.round(easting).toString().padStart(digits, '0')
    const northStr = Math.round(northing).toString().padStart(digits, '0')
    return eastStr + ' ' + northStr
  }

  // OZI Explorer Formel: Math.round(value / 10) % 10^digits
  const eastReduced = Math.round(easting / 10)
  const northReduced = Math.round(northing / 10)
  const mod = Math.pow(10, digits)

  const eastResult = (eastReduced % mod).toString().padStart(digits, '0')
  const northResult = (northReduced % mod).toString().padStart(digits, '0')

  return eastResult + ' ' + northResult
}

/**
 * Formatiert Lat/Lon im OziExplorer-Stil: 48° 57,254' N  10° 59,561' E
 */
export function formatLatLonOzi(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lonDir = lon >= 0 ? 'E' : 'W'

  const absLat = Math.abs(lat)
  const absLon = Math.abs(lon)

  const latDeg = Math.floor(absLat)
  const latMin = (absLat - latDeg) * 60

  const lonDeg = Math.floor(absLon)
  const lonMin = (absLon - lonDeg) * 60

  // Format: 48° 57,254' N (mit Komma als Dezimaltrennzeichen wie im Screenshot)
  return `${latDeg}° ${latMin.toFixed(3).replace('.', ',')}' ${latDir}  ${lonDeg}° ${lonMin.toFixed(3).replace('.', ',')}' ${lonDir}`
}

/**
 * Bestimmt den UTM-Zonenbuchstaben basierend auf der Latitude
 */
export function getUTMLatitudeBand(lat: number): string {
  const bands = 'CDEFGHJKLMNPQRSTUVWX'
  if (lat < -80) return 'A'
  if (lat > 84) return 'Z'
  const index = Math.floor((lat + 80) / 8)
  return bands[Math.min(index, bands.length - 1)]
}

/**
 * Formatiert UTM im OziExplorer-Stil: UTM 32U  6 45 880E  54 24 282N
 * Zeigt volle UTM-Koordinaten mit Leerzeichen-Gruppierung
 */
export function formatUTMOzi(easting: number, northing: number, zone: number, lat: number): string {
  const band = getUTMLatitudeBand(lat)

  // Easting: 645880 → "6 45 880E" (erste Ziffer = 100km, dann 2-stellig km, dann 3-stellig m)
  const eastInt = Math.round(easting)
  const eastStr = eastInt.toString().padStart(7, '0')
  // Gruppierung: X XX XXX (1 + 2 + 3 = 6 Ziffern für normale Werte, 7 für hohe)
  const e1 = eastStr.slice(0, -5) || '0'  // 100km Teil
  const e2 = eastStr.slice(-5, -3)        // km Teil (2 Ziffern)
  const e3 = eastStr.slice(-3)            // m Teil (3 Ziffern)

  // Northing: 5424282 → "54 24 282N"
  const northInt = Math.round(northing)
  const northStr = northInt.toString().padStart(7, '0')
  const n1 = northStr.slice(0, -5) || '0'  // 100km Teil
  const n2 = northStr.slice(-5, -3)        // km Teil (2 Ziffern)
  const n3 = northStr.slice(-3)            // m Teil (3 Ziffern)

  return `UTM ${zone}${band}  ${e1} ${e2} ${e3}E  ${n1} ${n2} ${n3}N`
}

/**
 * Parst eine Grid Reference zu UTM (OziExplorer Style)
 * Input: z.B. "1102 3010" (4/4 format)
 *
 * Regel (KORREKT):
 * 1. Grid Reference zeigt Meter INNERHALB des 100km Grid Squares
 * 2. Bei 4/4: "1102" bedeutet 11020 Meter (füge fehlende Nullen am ENDE hinzu für volle 5 Stellen)
 * 3. Addiere zur Basis des aktuellen 100km Squares
 *
 * Beispiel:
 * - Input: "1102 3010" (4/4)
 * - Erweitere: "11020" und "30100" (auf 5 Stellen mit Nullen am Ende)
 * - Base: 500000 liegt in Grid Square 500000-599999, also Base = 500000
 * - Ergebnis: 500000 + 11020 = 511020, 5300000 + 30100 = 5330100
 */
export function parseGridRef(ref: string, zone: number, hemisphere: 'N' | 'S', baseEasting: number = 500000, baseNorthing: number = 5300000): { easting: number; northing: number } | null {
  // Entferne alle Leerzeichen und Sonderzeichen
  const cleanRef = ref.replace(/\s+/g, '')
  const totalDigits = cleanRef.length

  // Easting und Northing haben gleiche Anzahl Stellen
  // z.B. "11023010" = 8 Stellen total = 4 Easting + 4 Northing (4/4 format)
  if (totalDigits % 2 !== 0) {
    return null
  }

  const digitsPerPart = totalDigits / 2

  // Erlaubte Formate: 4/4, 5/5, 6/6, 7/7, 8/8
  if (digitsPerPart < 4 || digitsPerPart > 8) {
    return null
  }

  const eastPart = cleanRef.substring(0, digitsPerPart)
  const northPart = cleanRef.substring(digitsPerPart)

  // Berechne die Basis des aktuellen 100km Grid Squares
  // Beispiel: baseEasting = 511025 → Grid Square Base = 500000
  const gridSquareEastBase = Math.floor(baseEasting / 100000) * 100000
  const gridSquareNorthBase = Math.floor(baseNorthing / 100000) * 100000

  // Erweitere die Grid Reference auf 5 Stellen (füge Nullen am ENDE hinzu)
  // Bei 4/4: "1102" → "11020" (10m Genauigkeit)
  // Bei 5/5: "11025" → "11025" (1m Genauigkeit)
  const eastWithin = eastPart.padEnd(5, '0')
  const northWithin = northPart.padEnd(5, '0')

  // Konvertiere zu Nummer
  const eastMeters = parseInt(eastWithin)
  const northMeters = parseInt(northWithin)

  // Validierung: Muss innerhalb 0-99999m sein
  if (eastMeters < 0 || eastMeters >= 100000 || northMeters < 0 || northMeters >= 100000) {
    return null
  }

  // Addiere zur Grid Square Base
  const easting = gridSquareEastBase + eastMeters
  const northing = gridSquareNorthBase + northMeters

  return { easting, northing }
}

/**
 * Formatiert Koordinaten im gewählten Format
 */
export function formatCoordinate(lat: number, lon: number, format: CoordinateFormat, utmZone: number = 33): string {
  switch (format) {
    case 'decimal':
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`

    case 'dm': {
      const latDeg = Math.floor(Math.abs(lat))
      const latMin = (Math.abs(lat) - latDeg) * 60
      const latDir = lat >= 0 ? 'N' : 'S'

      const lonDeg = Math.floor(Math.abs(lon))
      const lonMin = (Math.abs(lon) - lonDeg) * 60
      const lonDir = lon >= 0 ? 'E' : 'W'

      return `${latDeg}°${latMin.toFixed(3)}'${latDir} ${lonDeg}°${lonMin.toFixed(3)}'${lonDir}`
    }

    case 'dms': {
      const latDeg = Math.floor(Math.abs(lat))
      const latMinFull = (Math.abs(lat) - latDeg) * 60
      const latMin = Math.floor(latMinFull)
      const latSec = (latMinFull - latMin) * 60
      const latDir = lat >= 0 ? 'N' : 'S'

      const lonDeg = Math.floor(Math.abs(lon))
      const lonMinFull = (Math.abs(lon) - lonDeg) * 60
      const lonMin = Math.floor(lonMinFull)
      const lonSec = (lonMinFull - lonMin) * 60
      const lonDir = lon >= 0 ? 'E' : 'W'

      return `${latDeg}°${latMin}'${latSec.toFixed(1)}"${latDir} ${lonDeg}°${lonMin}'${lonSec.toFixed(1)}"${lonDir}`
    }

    case 'utm4':
    case 'utm5':
    case 'utm6':
    case 'utm7':
    case 'utm8': {
      const utm = latLonToUTM(lat, lon)
      const digits = parseInt(format.replace('utm', '')) as 4 | 5 | 6 | 7 | 8
      // OziExplorer Style: "67890 34567" für utm5
      return formatUTMGridRef(utm.easting, utm.northing, digits)
    }

    default:
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
  }
}

/**
 * Parst Koordinaten aus verschiedenen Formaten
 */
export function parseCoordinate(input: string, isLat: boolean, format: CoordinateFormat = 'decimal', utmZone: number = 33): number | null {
  input = input.trim()

  if (!input) return null

  // Dezimalgrad: 48.123456 oder -16.123456
  if (/^-?\d+\.?\d*$/.test(input)) {
    return parseFloat(input)
  }

  // Grad Minuten: 48 30.123 N oder 48°30.123'N
  const dmMatch = input.match(/(\d+)[°\s]+(\d+\.?\d*)['\s]*([NSEW])?/i)
  if (dmMatch) {
    const deg = parseInt(dmMatch[1])
    const min = parseFloat(dmMatch[2])
    let decimal = deg + min / 60
    if (dmMatch[3] && /[SW]/i.test(dmMatch[3])) decimal = -decimal
    return decimal
  }

  // Grad Minuten Sekunden: 48°30'15.5"N
  const dmsMatch = input.match(/(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["'\s]*([NSEW])?/i)
  if (dmsMatch) {
    const deg = parseInt(dmsMatch[1])
    const min = parseInt(dmsMatch[2])
    const sec = parseFloat(dmsMatch[3])
    let decimal = deg + min / 60 + sec / 3600
    if (dmsMatch[4] && /[SW]/i.test(dmsMatch[4])) decimal = -decimal
    return decimal
  }

  return null
}

/**
 * Parst eine Grid Reference (OziExplorer Style)
 * Input: "67890 34567" oder "6789034567"
 */
export function parseGridReference(input: string, utmZone: number = 33, baseEasting: number = 500000, baseNorthing: number = 5300000): { lat: number; lon: number } | null {
  const result = parseGridRef(input, utmZone, 'N', baseEasting, baseNorthing)
  if (!result) return null

  return utmToLatLon(result.easting, result.northing, utmZone, 'N')
}
