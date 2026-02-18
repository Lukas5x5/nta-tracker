// ============================================
// NTA - Navigation Tool Austria
// Weltweites Koordinatensystem basierend auf WGS84
// ============================================
//
// Unterstützte Formate:
// - Lat/Lon WGS84 (Decimal + DMS)
// - UTM WGS84 (alle Zonen, global)
// - MGRS (Military Grid Reference System) mit Precision 4/4, 5/5, 6/6
//
// Grunddatum: WGS84
// Interne Speicherung: Lat/Lon (WGS84)

// ============================================
// Type Definitions
// ============================================

export type CoordinateFormat =
  | 'decimal'      // Lat/Lon Decimal (48.123456, 15.148108)
  | 'dms'          // Lat/Lon DMS (48°12'34.5"N, 15°08'53.2"E)
  | 'dm'           // Lat/Lon Decimal Minutes (48°12.345'N, 15°08.887'E)
  | 'utm'          // UTM (33N 511025 5330100)
  | 'mgrs4'        // MGRS 4/4 (33U VK 1102 3010)
  | 'mgrs45'       // MGRS 4/5 (33U VK 1102 30100)
  | 'mgrs54'       // MGRS 5/4 (33U VK 11025 3010)
  | 'mgrs5'        // MGRS 5/5 (33U VK 11025 30100)
  | 'mgrs6'        // MGRS 6/6 (33U VK 110250 301000)

/**
 * Gibt Easting/Northing-Precision für ein Koordinatenformat zurück
 */
export function getGridPrecision(format: string): { east: number; north: number } {
  switch (format) {
    case 'mgrs4':  return { east: 4, north: 4 }
    case 'mgrs45': return { east: 4, north: 5 }
    case 'mgrs54': return { east: 5, north: 4 }
    case 'mgrs5':  return { east: 5, north: 5 }
    case 'mgrs6':  return { east: 6, north: 6 }
    default:       return { east: 5, north: 5 }
  }
}

export interface LatLonWGS84 {
  lat: number  // -90 to +90
  lon: number  // -180 to +180
}

export interface UTMWGS84 {
  zone: number        // 1-60
  hemisphere: 'N' | 'S'
  easting: number     // Meter
  northing: number    // Meter
}

export interface MGRS {
  gridZone: string        // z.B. "33U"
  square100km: string     // z.B. "VK"
  easting: string         // z.B. "11025" (5/5) oder "1102" (4/4)
  northing: string        // z.B. "30100" (5/5) oder "3010" (4/4)
  precision: 4 | 5 | 6    // Anzahl Stellen pro Koordinate
}

// ============================================
// WGS84 Ellipsoid Constants
// ============================================

const WGS84 = {
  a: 6378137.0,              // Semi-major axis (Equatorial radius) in meters
  f: 1 / 298.257223563,      // Flattening
  b: 6356752.314245,         // Semi-minor axis (Polar radius)
  e: 0.0818191908426,        // First eccentricity
  e2: 0.00669437999014        // e²
}

// ============================================
// UTM Constants
// ============================================

const UTM = {
  k0: 0.9996,                // Scale factor
  E0: 500000.0,              // False Easting
  N0: {
    north: 0.0,              // False Northing (Northern Hemisphere)
    south: 10000000.0        // False Northing (Southern Hemisphere)
  }
}

// ============================================
// MGRS 100km Square Letters
// ============================================

// MGRS verwendet spezielle Buchstaben für 100km Grid Squares
// Column letters (Easting): A-Z (ohne I und O)
const MGRS_COL_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

// Row letters (Northing): A-V (ohne I und O) in 3 Sets
const MGRS_ROW_LETTERS = [
  'ABCDEFGHJKLMNPQRSTUV',  // Set 1 (Zonen 1, 4, 7, ...)
  'FGHJKLMNPQRSTUVABCDE',  // Set 2 (Zonen 2, 5, 8, ...)
  'ABCDEFGHJKLMNPQRSTUV'   // Set 3 (Zonen 3, 6, 9, ...)
]

// Grid Zone Designator (Latitude Bands)
// C-X (ohne I und O), jeweils 8° breit, von 80°S bis 84°N
const MGRS_LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWXX'  // X ist doppelt (72-84°N)

// ============================================
// Lat/Lon ↔ UTM Conversion
// ============================================

/**
 * Berechnet die UTM Zone aus Longitude
 */
export function getUTMZone(lon: number): number {
  // Spezialfall: Svalbard (Norwegen)
  // Wird hier nicht implementiert, da sehr selten

  // Standard: Zone = floor((lon + 180) / 6) + 1
  return Math.floor((lon + 180) / 6) + 1
}

/**
 * Konvertiert Lat/Lon (WGS84) → UTM (WGS84)
 * @param lat Breitengrad
 * @param lon Längengrad
 * @param forceZone Optional: Erzwinge eine bestimmte UTM-Zone (für konsistentes Grid)
 */
export function latLonToUTM(lat: number, lon: number, forceZone?: number): UTMWGS84 {
  // Bestimme UTM Zone - verwende forceZone wenn gesetzt
  const zone = forceZone ?? getUTMZone(lon)

  // Bestimme Hemisphere
  const hemisphere: 'N' | 'S' = lat >= 0 ? 'N' : 'S'

  // Berechne Central Meridian der Zone
  const lonOrigin = (zone - 1) * 6 - 180 + 3  // Mitte der 6° breiten Zone

  // Konvertiere zu Radians
  const latRad = (lat * Math.PI) / 180
  const lonRad = (lon * Math.PI) / 180
  const lonOriginRad = (lonOrigin * Math.PI) / 180

  const N = WGS84.a / Math.sqrt(1 - WGS84.e2 * Math.sin(latRad) * Math.sin(latRad))
  const T = Math.tan(latRad) * Math.tan(latRad)
  const C = WGS84.e2 * Math.cos(latRad) * Math.cos(latRad) / (1 - WGS84.e2)
  const A = (lonRad - lonOriginRad) * Math.cos(latRad)

  // Meridional Arc
  const M = WGS84.a * (
    (1 - WGS84.e2 / 4 - 3 * WGS84.e2 * WGS84.e2 / 64 - 5 * WGS84.e2 * WGS84.e2 * WGS84.e2 / 256) * latRad -
    (3 * WGS84.e2 / 8 + 3 * WGS84.e2 * WGS84.e2 / 32 + 45 * WGS84.e2 * WGS84.e2 * WGS84.e2 / 1024) * Math.sin(2 * latRad) +
    (15 * WGS84.e2 * WGS84.e2 / 256 + 45 * WGS84.e2 * WGS84.e2 * WGS84.e2 / 1024) * Math.sin(4 * latRad) -
    (35 * WGS84.e2 * WGS84.e2 * WGS84.e2 / 3072) * Math.sin(6 * latRad)
  )

  // UTM Easting
  const easting = UTM.k0 * N * (
    A +
    (1 - T + C) * A * A * A / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * WGS84.e2 / (1 - WGS84.e2)) * A * A * A * A * A / 120
  ) + UTM.E0

  // UTM Northing
  let northing = UTM.k0 * (
    M + N * Math.tan(latRad) * (
      A * A / 2 +
      (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * WGS84.e2 / (1 - WGS84.e2)) * A * A * A * A * A * A / 720
    )
  )

  // Add false northing for southern hemisphere
  if (hemisphere === 'S') {
    northing += UTM.N0.south
  }

  return {
    zone,
    hemisphere,
    easting,  // Full precision
    northing  // Full precision
  }
}

/**
 * Konvertiert UTM (WGS84) → Lat/Lon (WGS84)
 */
export function utmToLatLon(utm: UTMWGS84): LatLonWGS84 {
  const { zone, hemisphere, easting, northing } = utm

  // Remove false easting/northing
  const x = easting - UTM.E0
  const y = hemisphere === 'S' ? northing - UTM.N0.south : northing

  // Central meridian
  const lonOrigin = (zone - 1) * 6 - 180 + 3

  // Footpoint latitude
  const M = y / UTM.k0
  const mu = M / (WGS84.a * (1 - WGS84.e2 / 4 - 3 * WGS84.e2 * WGS84.e2 / 64 - 5 * WGS84.e2 * WGS84.e2 * WGS84.e2 / 256))

  const e1 = (1 - Math.sqrt(1 - WGS84.e2)) / (1 + Math.sqrt(1 - WGS84.e2))

  const phi1 = mu +
    (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu) +
    (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu)

  const N1 = WGS84.a / Math.sqrt(1 - WGS84.e2 * Math.sin(phi1) * Math.sin(phi1))
  const T1 = Math.tan(phi1) * Math.tan(phi1)
  const C1 = WGS84.e2 * Math.cos(phi1) * Math.cos(phi1) / (1 - WGS84.e2)
  const R1 = WGS84.a * (1 - WGS84.e2) / Math.pow(1 - WGS84.e2 * Math.sin(phi1) * Math.sin(phi1), 1.5)
  const D = x / (N1 * UTM.k0)

  // Latitude
  let lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2 -
    (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * WGS84.e2 / (1 - WGS84.e2)) * D * D * D * D / 24 +
    (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * WGS84.e2 / (1 - WGS84.e2) - 3 * C1 * C1) * D * D * D * D * D * D / 720
  )

  // Longitude
  let lon = (
    D -
    (1 + 2 * T1 + C1) * D * D * D / 6 +
    (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * WGS84.e2 / (1 - WGS84.e2) + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / Math.cos(phi1)

  // Convert to degrees
  lat = (lat * 180) / Math.PI
  lon = lonOrigin + (lon * 180) / Math.PI

  return { lat, lon }
}

// ============================================
// UTM ↔ MGRS Conversion
// ============================================

/**
 * Berechnet Grid Zone Designator (z.B. "33U")
 */
function getGridZoneDesignator(lat: number, zone: number): string {
  // Latitude Band (8° wide, von -80 bis +84)
  // Spezialfall: Band X geht von 72°N bis 84°N (12° statt 8°)

  if (lat < -80 || lat > 84) {
    throw new Error('MGRS ist nur zwischen 80°S und 84°N definiert')
  }

  let bandIndex = Math.floor((lat + 80) / 8)
  if (bandIndex > 19) bandIndex = 19  // X band

  const band = MGRS_LAT_BANDS[bandIndex]

  return `${zone}${band}`
}

/**
 * Berechnet 100km Grid Square Letters
 */
function get100kmSquareID(zone: number, easting: number, northing: number): string {
  // Column letter (based on easting)
  const colIndex = Math.floor(easting / 100000) % 8
  const setNumber = ((zone - 1) % 3)  // 0, 1, or 2

  // Easting letter cycles every 8 columns
  const eastingLetter = MGRS_COL_LETTERS[(colIndex + (setNumber * 8)) % 24]

  // Row letter (based on northing)
  const rowIndex = Math.floor(northing / 100000) % 20
  const northingLetter = MGRS_ROW_LETTERS[setNumber][rowIndex]

  return eastingLetter + northingLetter
}

/**
 * Konvertiert UTM → MGRS
 */
export function utmToMGRS(utm: UTMWGS84, eastPrecision: 4 | 5 | 6 = 5, northPrecision?: 4 | 5 | 6): MGRS {
  const nPrec = northPrecision ?? eastPrecision
  const { zone, easting, northing } = utm

  // Berechne Lat für Grid Zone Designator (approximation)
  const latLon = utmToLatLon(utm)
  const gridZone = getGridZoneDesignator(latLon.lat, zone)

  // Berechne 100km Square
  const square100km = get100kmSquareID(zone, easting, northing)

  // OZI Explorer Formel: Math.round(value / 10) % 10^precision
  // Durch 10 teilen (letzte Ziffer abrunden), dann die letzten N Ziffern nehmen
  const eastReduced = Math.round(easting / 10)
  const northReduced = Math.round(northing / 10)

  const eastStr = (eastReduced % Math.pow(10, eastPrecision)).toString().padStart(eastPrecision, '0')
  const northStr = (northReduced % Math.pow(10, nPrec)).toString().padStart(nPrec, '0')

  return {
    gridZone,
    square100km,
    easting: eastStr,
    northing: northStr,
    precision: eastPrecision
  }
}

/**
 * Konvertiert MGRS → UTM
 */
export function mgrsToUTM(mgrs: MGRS): UTMWGS84 {
  const { gridZone, square100km, easting, northing, precision } = mgrs

  // Parse Grid Zone
  const zoneMatch = gridZone.match(/^(\d{1,2})([C-X])$/)
  if (!zoneMatch) {
    throw new Error(`Ungültiger Grid Zone Designator: ${gridZone}`)
  }

  const zone = parseInt(zoneMatch[1])
  const latBand = zoneMatch[2]

  // Bestimme Hemisphere aus Lat Band
  const hemisphere: 'N' | 'S' = latBand >= 'N' ? 'N' : 'S'

  // Dekodiere 100km Square Letters
  const eastLetter = square100km[0]
  const northLetter = square100km[1]

  // Finde Column (Easting) Index
  const setNumber = (zone - 1) % 3
  let colIndex = MGRS_COL_LETTERS.indexOf(eastLetter) - (setNumber * 8)
  if (colIndex < 0) colIndex += 24
  colIndex = colIndex % 8

  // Finde Row (Northing) Index
  const rowIndex = MGRS_ROW_LETTERS[setNumber].indexOf(northLetter)
  if (rowIndex === -1) {
    throw new Error(`Ungültiger 100km Square Letter: ${northLetter}`)
  }

  // Berechne Base Easting/Northing (100km Squares)
  const baseEasting = colIndex * 100000
  const baseNorthing = rowIndex * 100000

  // Parse Easting/Northing innerhalb des 100km Squares
  // MGRS Precision Interpretation (Standard):
  // - precision=4: "5190" bedeutet Position 51900m innerhalb 100km Square (10m Genauigkeit)
  //   → Erweitere "5190" auf 5 Stellen: "51900"
  // - precision=5: "51900" bedeutet Position 51900m (1m Genauigkeit)
  // - precision=6: "519000" bedeutet Position 51900.0m (0.1m Genauigkeit)
  //   → Kürze auf 5 Stellen: "51900"

  // Erweitere/Kürze auf 5 Stellen (= Meter innerhalb 100km)
  const eastWithin = easting.padEnd(5, '0').substring(0, 5)
  const northWithin = northing.padEnd(5, '0').substring(0, 5)

  const finalEasting = baseEasting + parseInt(eastWithin)
  let finalNorthing = baseNorthing + parseInt(northWithin)

  // Korrigiere Northing für die richtige 2M-Meter-Zone
  // (MGRS Northing wiederholt sich alle 2.000.000m)
  if (hemisphere === 'S') {
    // Southern hemisphere: Northing läuft von 10.000.000m runter
    // Dies ist eine Vereinfachung - in Realität komplexer
    finalNorthing = 10000000 - finalNorthing
  }

  return {
    zone,
    hemisphere,
    easting: finalEasting,
    northing: finalNorthing
  }
}

// ============================================
// MGRS ↔ Lat/Lon Conversion
// ============================================

/**
 * Konvertiert MGRS → Lat/Lon
 */
export function mgrsToLatLon(mgrs: MGRS): LatLonWGS84 {
  const utm = mgrsToUTM(mgrs)
  return utmToLatLon(utm)
}

/**
 * Konvertiert Lat/Lon → MGRS
 * @param forceZone Erzwinge UTM-Zone (z.B. von aktiver Wettkampfkarte)
 */
export function latLonToMGRS(lat: number, lon: number, eastPrecision: 4 | 5 | 6 = 5, northPrecision?: 4 | 5 | 6, forceZone?: number): MGRS {
  const utm = latLonToUTM(lat, lon, forceZone)
  return utmToMGRS(utm, eastPrecision, northPrecision)
}

// ============================================
// Format Conversion & Display
// ============================================

/**
 * Formatiert MGRS als String (OziExplorer kompatibel)
 * Beispiel: "33U VK 11025 30100"
 */
export function formatMGRS(mgrs: MGRS): string {
  return `${mgrs.gridZone} ${mgrs.square100km} ${mgrs.easting} ${mgrs.northing}`
}

/**
 * Parst MGRS String
 * Beispiel: "33U VK 11025 30100" oder "33UVK1102530100"
 */
export function parseMGRS(input: string): MGRS {
  // Remove all whitespace
  const cleaned = input.replace(/\s+/g, '').toUpperCase()

  // Match pattern: 33UVK1102530100
  const match = cleaned.match(/^(\d{1,2})([C-X])([A-Z]{2})(\d+)$/)

  if (!match) {
    throw new Error(`Ungültiges MGRS Format: ${input}`)
  }

  const zone = match[1]
  const band = match[2]
  const square = match[3]
  const coords = match[4]

  // Koordinaten müssen gerade Länge haben (gleich viele für E und N)
  if (coords.length % 2 !== 0 || coords.length < 8 || coords.length > 12) {
    throw new Error(`Ungültige MGRS Koordinatenlänge: ${coords}`)
  }

  const precision = (coords.length / 2) as 4 | 5 | 6
  const easting = coords.substring(0, precision)
  const northing = coords.substring(precision)

  return {
    gridZone: zone + band,
    square100km: square,
    easting,
    northing,
    precision
  }
}

/**
 * Formatiert UTM als String
 * Beispiel: "33N 511025 5330100"
 */
export function formatUTM(utm: UTMWGS84): string {
  const e = Math.round(utm.easting)
  const n = Math.round(utm.northing)
  return `${utm.zone}${utm.hemisphere} ${e} ${n}`
}

/**
 * Formatiert Lat/Lon als DMS
 * Beispiel: 48°12'34.5"N, 15°08'53.2"E
 */
export function formatLatLonDMS(lat: number, lon: number): string {
  const latDMS = decimalToDMS(Math.abs(lat))
  const lonDMS = decimalToDMS(Math.abs(lon))

  const latDir = lat >= 0 ? 'N' : 'S'
  const lonDir = lon >= 0 ? 'E' : 'W'

  return `${latDMS}${latDir}, ${lonDMS}${lonDir}`
}

/**
 * Konvertiert Decimal zu DMS
 */
function decimalToDMS(decimal: number): string {
  const degrees = Math.floor(decimal)
  const minutesDecimal = (decimal - degrees) * 60
  const minutes = Math.floor(minutesDecimal)
  const seconds = (minutesDecimal - minutes) * 60

  return `${degrees}°${minutes.toString().padStart(2, '0')}'${seconds.toFixed(1).padStart(4, '0')}"`
}

/**
 * Formatiert Koordinaten im gewählten Format
 */
export function formatCoordinate(lat: number, lon: number, format: CoordinateFormat, forceZone?: number): string {
  switch (format) {
    case 'decimal':
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`

    case 'dms':
      return formatLatLonDMS(lat, lon)

    case 'dm': {
      const latDeg = Math.floor(Math.abs(lat))
      const latMin = (Math.abs(lat) - latDeg) * 60
      const lonDeg = Math.floor(Math.abs(lon))
      const lonMin = (Math.abs(lon) - lonDeg) * 60
      const latDir = lat >= 0 ? 'N' : 'S'
      const lonDir = lon >= 0 ? 'E' : 'W'
      return `${latDeg}°${latMin.toFixed(3)}'${latDir}, ${lonDeg}°${lonMin.toFixed(3)}'${lonDir}`
    }

    case 'utm':
      return formatUTM(latLonToUTM(lat, lon, forceZone))

    case 'mgrs4':
      return formatMGRS(latLonToMGRS(lat, lon, 4, 4, forceZone))

    case 'mgrs45':
      return formatMGRS(latLonToMGRS(lat, lon, 4, 5, forceZone))

    case 'mgrs54':
      return formatMGRS(latLonToMGRS(lat, lon, 5, 4, forceZone))

    case 'mgrs5':
      return formatMGRS(latLonToMGRS(lat, lon, 5, 5, forceZone))

    case 'mgrs6':
      return formatMGRS(latLonToMGRS(lat, lon, 6, 6, forceZone))

    default:
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
  }
}

// ============================================
// Test Examples (Europa, USA, Australien)
// ============================================

// ============================================
// Grid Reference Functions (für BriefingSidebar)
// ============================================

/**
 * Formatiert UTM Easting/Northing als Grid Reference
 * @param easting UTM Easting in Metern
 * @param northing UTM Northing in Metern
 * @param digits Anzahl der Stellen (4, 5, 6 oder 8)
 */
export function formatUTMGridRef(easting: number, northing: number, digits: 4 | 5 | 6 | 8 = 5): string {
  if (digits === 8) {
    // 8 Stellen - full easting/northing
    const eastingStr = Math.round(easting).toString().padStart(7, '0')
    const northingStr = Math.round(northing).toString().padStart(7, '0')
    return `${eastingStr} ${northingStr}`
  }

  // OZI Explorer Formel: Math.round(value / 10) % 10^digits
  const eastReduced = Math.round(easting / 10)
  const northReduced = Math.round(northing / 10)
  const mod = Math.pow(10, digits)

  const eastStr = (eastReduced % mod).toString().padStart(digits, '0')
  const northStr = (northReduced % mod).toString().padStart(digits, '0')
  return `${eastStr} ${northStr}`
}

/**
 * Rekonstruiert volle UTM-Koordinaten aus Grid Reference Eingabe.
 * Umkehrung der OZI Explorer Formel:
 *   gridRef = Math.round(fullUTM / 10) % 10^precision
 *
 * Rückrechnung:
 *   reduced = Math.round(refValue / 10)
 *   prefix = Math.floor(reduced / 10^precision)
 *   fullUTM = (prefix * 10^precision + inputValue) * 10
 */
export function gridRefToFullUTM(
  eastInput: string,
  northInput: string,
  eastPrecision: 4 | 5 | 6,
  northPrecision: 4 | 5 | 6,
  refEasting: number,
  refNorthing: number
): { easting: number; northing: number } {
  const eastValue = parseInt(eastInput.padEnd(eastPrecision, '0')) || 0
  const northValue = parseInt(northInput.padEnd(northPrecision, '0')) || 0

  const eastMod = Math.pow(10, eastPrecision)
  const northMod = Math.pow(10, northPrecision)

  // Prefix aus Referenz berechnen
  const eastPrefix = Math.floor(Math.round(refEasting / 10) / eastMod)
  const northPrefix = Math.floor(Math.round(refNorthing / 10) / northMod)

  // Volle UTM = (prefix * mod + eingabe) * 10
  const easting = (eastPrefix * eastMod + eastValue) * 10
  const northing = (northPrefix * northMod + northValue) * 10

  return { easting, northing }
}

/**
 * Parst eine Grid Reference und gibt Lat/Lon zurück
 * @param gridRef Die Grid Reference (z.B. "11025 30100")
 * @param utmZone Die UTM Zone (z.B. 33)
 * @param baseEasting Basis-Easting (z.B. 500000)
 * @param baseNorthing Basis-Northing (z.B. 5300000)
 */
export function parseGridReference(
  gridRef: string,
  utmZone: number,
  baseEasting: number,
  baseNorthing: number
): { lat: number; lon: number } | null {
  // Entferne Leerzeichen und teile
  const clean = gridRef.trim().replace(/\s+/g, ' ')
  const parts = clean.split(' ')

  if (parts.length !== 2) return null

  const eastingPart = parts[0]
  const northingPart = parts[1]

  // Versuche die Werte zu parsen
  if (isNaN(parseInt(eastingPart)) || isNaN(parseInt(northingPart))) return null

  const eastLen = eastingPart.length as 4 | 5 | 6
  const northLen = northingPart.length as 4 | 5 | 6

  const { easting, northing } = gridRefToFullUTM(
    eastingPart, northingPart,
    eastLen, northLen,
    baseEasting, baseNorthing
  )

  // Konvertiere zu Lat/Lon
  const utm: UTMWGS84 = {
    zone: utmZone,
    hemisphere: 'N',
    easting,
    northing
  }

  const latLon = utmToLatLon(utm)
  return { lat: latLon.lat, lon: latLon.lon }
}

export const TEST_LOCATIONS = {
  // Wien, Österreich
  vienna: { lat: 48.208176, lon: 15.148108, name: 'Wien, Österreich' },

  // München, Deutschland
  munich: { lat: 48.135125, lon: 11.581981, name: 'München, Deutschland' },

  // New York, USA
  newYork: { lat: 40.712776, lon: -74.005974, name: 'New York, USA' },

  // Sydney, Australien
  sydney: { lat: -33.868820, lon: 151.209290, name: 'Sydney, Australien' },

  // Kapstadt, Südafrika
  capeTown: { lat: -33.924870, lon: 18.424055, name: 'Kapstadt, Südafrika' },

  // Tokio, Japan
  tokyo: { lat: 35.689487, lon: 139.691711, name: 'Tokio, Japan' }
}
