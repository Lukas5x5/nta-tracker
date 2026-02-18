import type { ProhibitedZone } from '../../shared/types'

/**
 * Parser für PZ (Prohibited Zones) Dateien
 * Unterstützt GPX und OziExplorer WPT Format
 */

// GPX Parser
export function parseGPX(content: string): ProhibitedZone[] {
  const zones: ProhibitedZone[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(content, 'text/xml')

    // Check for parse errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      console.error('[PZ Parser] GPX Parse Error:', parseError.textContent)
      return []
    }

    // Find all waypoints
    const waypoints = doc.querySelectorAll('wpt')

    waypoints.forEach((wpt, index) => {
      const lat = parseFloat(wpt.getAttribute('lat') || '0')
      const lon = parseFloat(wpt.getAttribute('lon') || '0')

      if (lat === 0 && lon === 0) return

      const nameEl = wpt.querySelector('name')
      const descEl = wpt.querySelector('desc')
      const eleEl = wpt.querySelector('ele')

      const name = nameEl?.textContent || `PZ ${index + 1}`
      const description = descEl?.textContent || undefined
      const elevation = eleEl ? parseFloat(eleEl.textContent || '0') : undefined

      zones.push({
        id: `pz-${Date.now()}-${index}`,
        name,
        description,
        lat,
        lon,
        elevation: elevation && elevation > -1000 ? elevation : undefined,
        warningDisabled: true  // PZ ohne Radius haben standardmäßig keine Warnung
      })
    })

    console.log(`[PZ Parser] GPX: ${zones.length} Zonen gefunden`)
  } catch (err) {
    console.error('[PZ Parser] GPX Fehler:', err)
  }

  return zones
}

// OziExplorer WPT Parser
export function parseWPT(content: string): ProhibitedZone[] {
  const zones: ProhibitedZone[] = []

  try {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l)

    // Skip header lines (first 4 lines in OziExplorer format)
    // Line 1: "OziExplorer Waypoint File Version 1.1"
    // Line 2: Datum (e.g., "WGS 84")
    // Line 3: "Reserved 2"
    // Line 4: Empty or reserved

    let dataStartIndex = 0
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (lines[i].toLowerCase().includes('oziexplorer') ||
          lines[i].toLowerCase().includes('wgs') ||
          lines[i].toLowerCase().includes('reserved') ||
          lines[i] === '') {
        dataStartIndex = i + 1
      }
    }

    // Parse waypoint lines
    // Format: Number,Name,Latitude,Longitude,Date,Symbol,Status,MapDisplayFormat,FGColor,BGColor,Description,...
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i]
      if (!line || line.startsWith(';')) continue

      const parts = line.split(',')
      if (parts.length < 4) continue

      // Index 1 = Name, Index 2 = Lat, Index 3 = Lon
      const name = parts[1]?.trim() || `PZ ${i}`
      const lat = parseFloat(parts[2]?.trim() || '0')
      const lon = parseFloat(parts[3]?.trim() || '0')

      if (lat === 0 && lon === 0) continue
      if (isNaN(lat) || isNaN(lon)) continue

      // Description is usually at index 10
      const description = parts[10]?.trim() || undefined

      // OziExplorer Extended Format:
      // Index 13 = Radius (proximity distance in meters)
      // Index 14 = Altitude/Elevation
      let radius: number | undefined
      let elevation: number | undefined

      if (parts[13]) {
        const rad = parseFloat(parts[13])
        if (!isNaN(rad) && rad > 0) {
          radius = rad
        }
      }

      if (parts[14]) {
        const elev = parseFloat(parts[14])
        // -777 bedeutet "keine Höhe" in OziExplorer
        if (!isNaN(elev) && elev > -500) {
          elevation = elev
        }
      }

      zones.push({
        id: `pz-${Date.now()}-${i}`,
        name,
        description,
        lat,
        lon,
        radius,
        elevation,
        warningDisabled: !radius  // PZ ohne Radius haben standardmäßig keine Warnung
      })
    }

    console.log(`[PZ Parser] WPT: ${zones.length} Zonen gefunden`)
  } catch (err) {
    console.error('[PZ Parser] WPT Fehler:', err)
  }

  return zones
}

// OziExplorer PLT (Track) Parser - für Polygon-PZ
export function parsePLT(content: string, filename: string): ProhibitedZone[] {
  const zones: ProhibitedZone[] = []

  try {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l)

    // PLT Header Format:
    // Line 1: "OziExplorer Track Point File Version 2.1"
    // Line 2: Datum (e.g., "WGS 84")
    // Line 3: "Altitude is in Feet"
    // Line 4: "Reserved 3"
    // Line 5: Track info: "0,Width,Color,Name,Skip,Type,FillStyle,FillColor,TrackType,Fill"
    //         z.B. "0,7,255,PZ_ALLENSTEIG,0,10,5,255,-1,0"
    // Line 6: Point count
    // Line 7+: Track points

    if (lines.length < 7) {
      console.warn('[PZ Parser] PLT zu kurz:', lines.length, 'Zeilen')
      return []
    }

    // Parse Track Name from Line 5 (index 4)
    let trackName = filename.replace(/\.plt$/i, '')
    const infoLine = lines[4]
    if (infoLine) {
      const infoParts = infoLine.split(',')
      if (infoParts.length >= 4 && infoParts[3]) {
        trackName = infoParts[3].trim()
      }
    }

    // Check if altitude is in feet
    const altitudeInFeet = lines[2]?.toLowerCase().includes('feet')

    // Parse point count from Line 6 (index 5)
    const pointCount = parseInt(lines[5], 10)
    if (isNaN(pointCount) || pointCount < 3) {
      console.warn('[PZ Parser] PLT ungültige Punktanzahl:', lines[5])
      return []
    }

    // Parse track points from Line 7+ (index 6+)
    const polygon: { lat: number; lon: number }[] = []
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
    let sumLat = 0, sumLon = 0

    for (let i = 6; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue

      // Format: "  48.736181,  15.364149,1, -777.0,42943.8011238, 27-Jul-17, 7:13:37 PM"
      // Parts: lat, lon, new_segment, altitude, OLE_date, date, time
      const parts = line.split(',')
      if (parts.length < 2) continue

      const lat = parseFloat(parts[0]?.trim() || '0')
      const lon = parseFloat(parts[1]?.trim() || '0')

      if (isNaN(lat) || isNaN(lon)) continue
      if (lat === 0 && lon === 0) continue

      polygon.push({ lat, lon })

      // Track bounds for center calculation
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
      sumLat += lat
      sumLon += lon
    }

    if (polygon.length < 3) {
      console.warn('[PZ Parser] PLT zu wenig Punkte:', polygon.length)
      return []
    }

    // Calculate center (centroid)
    const centerLat = sumLat / polygon.length
    const centerLon = sumLon / polygon.length

    // Create polygon PZ
    zones.push({
      id: `pz-plt-${Date.now()}`,
      name: trackName,
      lat: centerLat,
      lon: centerLon,
      type: 'polygon',
      polygon: polygon
    })

    console.log(`[PZ Parser] PLT: "${trackName}" mit ${polygon.length} Punkten geladen`)
  } catch (err) {
    console.error('[PZ Parser] PLT Fehler:', err)
  }

  return zones
}

// Auto-detect format and parse
export function parsePZFile(content: string, filename: string): ProhibitedZone[] {
  const ext = filename.toLowerCase().split('.').pop()

  // PLT (Track) files for polygon PZ
  if (ext === 'plt' || content.toLowerCase().includes('track point file')) {
    return parsePLT(content, filename)
  }

  if (ext === 'gpx' || content.includes('<?xml') || content.includes('<gpx')) {
    return parseGPX(content)
  } else if (ext === 'wpt' || content.toLowerCase().includes('oziexplorer waypoint')) {
    return parseWPT(content)
  }

  // Try all parsers
  const pltResult = parsePLT(content, filename)
  if (pltResult.length > 0) return pltResult

  const gpxResult = parseGPX(content)
  if (gpxResult.length > 0) return gpxResult

  const wptResult = parseWPT(content)
  if (wptResult.length > 0) return wptResult

  console.warn('[PZ Parser] Unbekanntes Format:', filename)
  return []
}

// ============================================
// Export Functions
// ============================================

// Export a single polygon PZ to PLT format (OziExplorer-compatible)
export function exportPZtoPLT(pz: ProhibitedZone): string {
  const lines: string[] = []

  // Header - NTA Format (kompatibel mit OziExplorer)
  lines.push('NTA Balloon Navigator Track File Version 1.0')
  lines.push('WGS 84')
  lines.push('Altitude is in Feet')
  lines.push('Exported from NTA')

  // Track info line: "0,Width,Color,Name,Skip,Type,FillStyle,FillColor,TrackType,Fill"
  // Color 255 = Red (0x0000FF in BGR), Width 7
  const name = pz.name.replace(/,/g, '_').substring(0, 40).padEnd(40, ' ')
  lines.push(`0,7,255,${name},0,10,5,255,-1,0`)

  // Get points
  const points = pz.type === 'polygon' && pz.polygon ? pz.polygon : [{ lat: pz.lat, lon: pz.lon }]

  // Point count
  lines.push(points.length.toString())

  // Track points
  // Format: "  lat,  lon,new_segment, altitude,OLE_date, date, time"
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' }).replace(',', '')
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
  const oleDate = (now.getTime() / 86400000) + 25569 // Excel/OLE date

  points.forEach((point, index) => {
    const newSegment = index === 0 ? 1 : 0
    const altitude = pz.elevation || -777.0 // Elevation is already in ft
    lines.push(`  ${point.lat.toFixed(6)},  ${point.lon.toFixed(6)},${newSegment}, ${altitude.toFixed(1)},${oleDate.toFixed(7)}, ${dateStr}, ${timeStr}`)
  })

  return lines.join('\r\n')
}

// Export polygon PZ to WPT format (waypoints for each vertex)
export function exportPZtoWPT(pz: ProhibitedZone): string {
  const lines: string[] = []

  // Header - NTA Format (kompatibel mit OziExplorer)
  lines.push('NTA Balloon Navigator Waypoint File Version 1.0')
  lines.push('WGS 84')
  lines.push('Exported from NTA')
  lines.push('Reserved')

  // Get points
  const points = pz.type === 'polygon' && pz.polygon ? pz.polygon : [{ lat: pz.lat, lon: pz.lon }]

  // Waypoint lines
  // Format: Number,Name,Latitude,Longitude,Date,Symbol,Status,MapDisplayFormat,FGColor,BGColor,Description,PointerDir,Garmin,Proximity,Altitude
  points.forEach((point, index) => {
    const wpName = points.length > 1
      ? `${pz.name}_${(index + 1).toString().padStart(3, '0')}`
      : pz.name
    const altitude = pz.elevation || -777
    const radius = pz.radius || 0  // Proximity/Radius in Metern
    lines.push(`${index + 1},${wpName.substring(0, 40)},${point.lat.toFixed(6)},${point.lon.toFixed(6)},0,1,3,0,65535,65535,${pz.description || ''},0,0,${radius},${altitude}`)
  })

  return lines.join('\r\n')
}

// Export multiple PZ points to a single WPT file
export function exportAllPZtoWPT(zones: ProhibitedZone[]): string {
  const lines: string[] = []

  // Header - NTA Format (kompatibel mit OziExplorer)
  lines.push('NTA Balloon Navigator Waypoint File Version 1.0')
  lines.push('WGS 84')
  lines.push('Exported from NTA')
  lines.push('Reserved')

  let wpIndex = 1
  zones.forEach(pz => {
    const points = pz.type === 'polygon' && pz.polygon ? pz.polygon : [{ lat: pz.lat, lon: pz.lon }]
    points.forEach((point, index) => {
      const wpName = points.length > 1
        ? `${pz.name}_${(index + 1).toString().padStart(3, '0')}`
        : pz.name
      const altitude = pz.elevation || -777
      const radius = pz.radius || 0  // Proximity/Radius in Metern
      lines.push(`${wpIndex},${wpName.substring(0, 40)},${point.lat.toFixed(6)},${point.lon.toFixed(6)},0,1,3,0,65535,65535,${pz.description || ''},0,0,${radius},${altitude}`)
      wpIndex++
    })
  })

  return lines.join('\r\n')
}

// Export multiple PZ polygons/tracks to a single PLT file
export function exportAllPZtoPLT(zones: ProhibitedZone[]): string {
  const lines: string[] = []

  // Header - NTA Format (kompatibel mit OziExplorer)
  lines.push('NTA Balloon Navigator Track File Version 1.0')
  lines.push('WGS 84')
  lines.push('Altitude is in Feet')
  lines.push('Exported from NTA')

  // Zähle alle Punkte
  let totalPoints = 0
  zones.forEach(pz => {
    const points = pz.type === 'polygon' && pz.polygon ? pz.polygon : [{ lat: pz.lat, lon: pz.lon }]
    totalPoints += points.length
  })

  // Track info line (für ersten Track)
  const firstName = zones[0]?.name.replace(/,/g, '_').substring(0, 40).padEnd(40, ' ') || 'Track'
  lines.push(`0,7,255,${firstName},0,10,5,255,-1,0`)

  // Point count
  lines.push(totalPoints.toString())

  // Alle Track-Punkte
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' }).replace(',', '')
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
  const oleDate = (now.getTime() / 86400000) + 25569

  zones.forEach((pz, zoneIndex) => {
    const points = pz.type === 'polygon' && pz.polygon ? pz.polygon : [{ lat: pz.lat, lon: pz.lon }]
    points.forEach((point, pointIndex) => {
      // Neues Segment bei jedem Track-Start
      const newSegment = pointIndex === 0 ? 1 : 0
      const altitude = pz.elevation || -777.0
      lines.push(`  ${point.lat.toFixed(6)},  ${point.lon.toFixed(6)},${newSegment}, ${altitude.toFixed(1)},${oleDate.toFixed(7)}, ${dateStr}, ${timeStr}`)
    })
  })

  return lines.join('\r\n')
}

// Download helper function
export function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
