/**
 * Formatierungs-Utilities für NTA
 */

/**
 * Formatiert Höhe basierend auf Einheit
 */
export function formatAltitude(meters: number, unit: 'meters' | 'feet'): string {
  if (unit === 'feet') {
    return Math.round(meters * 3.28084).toString()
  }
  return Math.round(meters).toString()
}

/**
 * Formatiert Geschwindigkeit basierend auf Einheit
 */
export function formatSpeed(kmh: number, unit: 'kmh' | 'knots' | 'mph' | 'ms'): string {
  switch (unit) {
    case 'knots':
      return (kmh * 0.539957).toFixed(1)
    case 'mph':
      return (kmh * 0.621371).toFixed(1)
    case 'ms':
      return (kmh / 3.6).toFixed(1)
    default:
      return kmh.toFixed(1)
  }
}

/**
 * Formatiert Kurs/Heading (ohne führende Nullen)
 */
export function formatHeading(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360
  return Math.round(normalized).toString()
}

/**
 * Formatiert Variometer basierend auf Einheit
 */
export function formatVariometer(ms: number, unit: 'ms' | 'fpm'): string {
  if (unit === 'fpm') {
    return Math.round(ms * 196.85).toString()
  }
  return ms.toFixed(1)
}

/**
 * Formatiert Distanz basierend auf Einheit
 */
export function formatDistance(meters: number, unit: 'meters' | 'feet' | 'nm'): string {
  switch (unit) {
    case 'feet':
      return Math.round(meters * 3.28084).toString()
    case 'nm':
      return (meters / 1852).toFixed(2)
    default:
      if (meters >= 10000) {
        return (meters / 1000).toFixed(1) + 'k'
      }
      return Math.round(meters).toString()
  }
}

/**
 * Formatiert Zeit als HH:MM:SS
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-AT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * Formatiert UTC Zeit
 */
export function formatUTCTime(date: Date): string {
  return date.toISOString().substring(11, 19)
}

/**
 * Formatiert Koordinaten im Grad-Minuten Format
 */
export function formatCoordDM(decimal: number, isLatitude: boolean): string {
  const abs = Math.abs(decimal)
  const degrees = Math.floor(abs)
  const minutes = (abs - degrees) * 60

  const direction = isLatitude
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W')

  const degPad = isLatitude ? 2 : 3
  return `${degrees.toString().padStart(degPad, '0')}° ${minutes.toFixed(3)}' ${direction}`
}

/**
 * Formatiert Koordinaten im Grad-Minuten-Sekunden Format
 */
export function formatCoordDMS(decimal: number, isLatitude: boolean): string {
  const abs = Math.abs(decimal)
  const degrees = Math.floor(abs)
  const minutesFull = (abs - degrees) * 60
  const minutes = Math.floor(minutesFull)
  const seconds = (minutesFull - minutes) * 60

  const direction = isLatitude
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W')

  const degPad = isLatitude ? 2 : 3
  return `${degrees.toString().padStart(degPad, '0')}° ${minutes.toString().padStart(2, '0')}' ${seconds.toFixed(1)}" ${direction}`
}

/**
 * Formatiert Druck
 */
export function formatPressure(hPa: number, unit: 'hPa' | 'inHg'): string {
  if (unit === 'inHg') {
    return (hPa * 0.02953).toFixed(2)
  }
  return hPa.toFixed(1)
}

/**
 * Formatiert Dauer in Sekunden zu HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * Formatiert Windrichtung mit Himmelsrichtung
 */
export function formatWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(degrees / 22.5) % 16
  return `${Math.round(degrees)}° (${directions[index]})`
}
