/**
 * Navigations-Utilities für NTA
 * Geodätische Berechnungen für Heißluftballon-Navigation
 */

// Erdradius in Metern
const EARTH_RADIUS = 6371000

/**
 * Konvertiert Grad zu Radiant
 */
function toRad(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Konvertiert Radiant zu Grad
 */
function toDeg(radians: number): number {
  return radians * (180 / Math.PI)
}

/**
 * Berechnet die Distanz zwischen zwei Punkten (Haversine Formel)
 * @returns Distanz in Metern
 */
export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS * c
}

/**
 * Berechnet die 3D Distanz (inkl. Höhenunterschied)
 * @returns Distanz in Metern
 */
export function calculateDistance3D(
  lat1: number, lon1: number, alt1: number,
  lat2: number, lon2: number, alt2: number
): number {
  const horizontalDist = calculateDistance(lat1, lon1, lat2, lon2)
  const verticalDist = alt2 - alt1

  return Math.sqrt(horizontalDist * horizontalDist + verticalDist * verticalDist)
}

/**
 * Berechnet die Peilung (Initial Bearing) zwischen zwei Punkten
 * @returns Peilung in Grad (0-360)
 */
export function calculateBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const dLon = toRad(lon2 - lon1)
  const lat1Rad = toRad(lat1)
  const lat2Rad = toRad(lat2)

  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  const bearing = toDeg(Math.atan2(y, x))

  return (bearing + 360) % 360
}

/**
 * Berechnet den Transit Point (nächster Punkt zum Ziel basierend auf aktuellem Track)
 * Gibt die Position zurück, an der man dem Ziel am nächsten kommt, wenn man
 * den aktuellen Kurs beibehält.
 */
export function calculateTransitPoint(
  currentLat: number, currentLon: number,
  heading: number,
  targetLat: number, targetLon: number
): { lat: number; lon: number; distance: number } {
  // Berechne Peilung zum Ziel
  const bearingToTarget = calculateBearing(currentLat, currentLon, targetLat, targetLon)

  // Winkel zwischen Kurs und Ziel
  const angleDiff = toRad(bearingToTarget - heading)

  // Distanz zum Ziel
  const distToTarget = calculateDistance(currentLat, currentLon, targetLat, targetLon)

  // Distanz zum Transit Point (auf dem aktuellen Kurs)
  const transitDist = distToTarget * Math.cos(angleDiff)

  // Berechne Transit Point Position
  const transitPoint = calculateDestination(currentLat, currentLon, heading, transitDist)

  // Minimale Distanz zum Ziel am Transit Point
  const minDistance = Math.abs(distToTarget * Math.sin(angleDiff))

  return {
    lat: transitPoint.lat,
    lon: transitPoint.lon,
    distance: minDistance
  }
}

/**
 * Berechnet Zielposition basierend auf Start, Kurs und Distanz
 */
export function calculateDestination(
  lat: number, lon: number,
  bearing: number,
  distance: number
): { lat: number; lon: number } {
  const latRad = toRad(lat)
  const lonRad = toRad(lon)
  const bearingRad = toRad(bearing)
  const angularDist = distance / EARTH_RADIUS

  const destLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDist) +
    Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearingRad)
  )

  const destLonRad = lonRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(latRad),
    Math.cos(angularDist) - Math.sin(latRad) * Math.sin(destLatRad)
  )

  return {
    lat: toDeg(destLatRad),
    lon: toDeg(destLonRad)
  }
}

/**
 * Berechnet den Winkel für Elbow Task
 * @returns Winkel in Grad
 */
export function calculateElbowAngle(
  point1Lat: number, point1Lon: number,
  vertexLat: number, vertexLon: number,
  point2Lat: number, point2Lon: number
): number {
  const bearing1 = calculateBearing(vertexLat, vertexLon, point1Lat, point1Lon)
  const bearing2 = calculateBearing(vertexLat, vertexLon, point2Lat, point2Lon)

  let angle = Math.abs(bearing2 - bearing1)

  if (angle > 180) {
    angle = 360 - angle
  }

  return angle
}

/**
 * Prüft ob ein Punkt innerhalb eines Kreises liegt
 */
export function isPointInCircle(
  pointLat: number, pointLon: number,
  centerLat: number, centerLon: number,
  radius: number
): boolean {
  const distance = calculateDistance(pointLat, pointLon, centerLat, centerLon)
  return distance <= radius
}

/**
 * Berechnet die voraussichtliche Ankunftszeit (ETA) zum Ziel
 * @returns ETA in Sekunden, oder null wenn keine Annäherung
 */
export function calculateETA(
  currentLat: number, currentLon: number,
  targetLat: number, targetLon: number,
  speed: number, // m/s
  heading: number
): number | null {
  if (speed < 0.5) return null // Zu langsam für sinnvolle Berechnung

  const bearingToTarget = calculateBearing(currentLat, currentLon, targetLat, targetLon)
  const angleDiff = Math.abs(bearingToTarget - heading)

  // Effektive Geschwindigkeit in Zielrichtung
  const effectiveSpeed = speed * Math.cos(toRad(angleDiff))

  if (effectiveSpeed <= 0) return null // Bewegt sich vom Ziel weg

  const distance = calculateDistance(currentLat, currentLon, targetLat, targetLon)
  return distance / effectiveSpeed
}

/**
 * Berechnet Wind aus zwei Positionen und Zeiten
 */
export function calculateWind(
  lat1: number, lon1: number, time1: Date,
  lat2: number, lon2: number, time2: Date
): { direction: number; speed: number } {
  const timeDiff = (time2.getTime() - time1.getTime()) / 1000 // Sekunden

  if (timeDiff <= 0) {
    return { direction: 0, speed: 0 }
  }

  const distance = calculateDistance(lat1, lon1, lat2, lon2)
  const bearing = calculateBearing(lat1, lon1, lat2, lon2)

  // Windrichtung ist entgegengesetzt zur Bewegungsrichtung
  // (Wind kommt von, nicht geht nach)
  const windDirection = (bearing + 180) % 360

  // Windgeschwindigkeit in m/s
  const windSpeed = distance / timeDiff

  return {
    direction: windDirection,
    speed: windSpeed
  }
}

/**
 * Berechnet den Drop Angle für Marker-Abwurf aus größerer Höhe
 * Berücksichtigt Fallzeit und horizontale Drift
 */
export function calculateDropAngle(
  altitude: number, // Höhe über Ziel in Metern
  groundSpeed: number, // m/s
  heading: number
): { angle: number; leadDistance: number } {
  // Vereinfachte Berechnung: Fallzeit = sqrt(2h/g)
  const g = 9.81 // m/s²
  const fallTime = Math.sqrt((2 * altitude) / g)

  // Horizontale Drift während des Falls
  const leadDistance = groundSpeed * fallTime

  // Abwurfwinkel (vom Ballon aus gesehen)
  const angle = toDeg(Math.atan(altitude / leadDistance))

  return {
    angle,
    leadDistance
  }
}

// ═══════════════════════════════════════════════════════════════════
// Landeprognose - Wo komme ich am Boden an?
// ═══════════════════════════════════════════════════════════════════

export interface LandingPredictionPoint {
  lat: number
  lon: number
  altitude: number  // MSL in Metern
  timeSeconds: number  // Sekunden ab jetzt
}

export interface LandingPrediction {
  path: LandingPredictionPoint[]  // Abstiegspfad (alle Zwischenpunkte)
  landingPoint: LandingPredictionPoint  // Endpunkt am Boden
  groundElevation: number  // Bodenhöhe am Landepunkt (Meter MSL)
  totalTimeSeconds: number  // Gesamtdauer Abstieg
  totalDistanceMeters: number  // Horizontale Distanz Start→Landepunkt
}

interface WindLayerInput {
  altitude: number  // Meter MSL
  direction: number  // Grad (woher der Wind kommt)
  speed: number      // km/h
}

/**
 * Ermittelt Wind für eine gegebene Höhe aus den gemessenen Windschichten.
 * Verwendet die nächstgelegene Schicht (diskret/stufenweise) statt Interpolation,
 * da ein Ballon Trägheit hat und nicht sofort den Wind einer neuen Schicht annimmt.
 * - Zwischen zwei Schichten: Wind der nächstgelegenen Schicht
 * - Über der höchsten Schicht: Wind der höchsten Schicht
 * - Unter der niedrigsten Schicht: Wind der niedrigsten Schicht
 */
export function interpolateWind(
  altitude: number,
  layers: WindLayerInput[]
): { direction: number; speedMs: number } {
  if (layers.length === 0) {
    return { direction: 0, speedMs: 0 }
  }

  // Sortiere nach Höhe aufsteigend
  const sorted = [...layers].sort((a, b) => a.altitude - b.altitude)

  // Unter der niedrigsten Schicht
  if (altitude <= sorted[0].altitude) {
    return {
      direction: sorted[0].direction,
      speedMs: sorted[0].speed / 3.6  // km/h → m/s
    }
  }

  // Über der höchsten Schicht
  if (altitude >= sorted[sorted.length - 1].altitude) {
    const top = sorted[sorted.length - 1]
    return {
      direction: top.direction,
      speedMs: top.speed / 3.6
    }
  }

  // Zwischen zwei Schichten: Wind der nächstgelegenen Schicht verwenden
  // (kein Interpolieren – Ballon hat Trägheit und nimmt nicht sofort
  // den Wind einer neuen Schicht an)
  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i]
    const upper = sorted[i + 1]
    if (altitude >= lower.altitude && altitude <= upper.altitude) {
      const midpoint = (lower.altitude + upper.altitude) / 2
      const nearest = altitude <= midpoint ? lower : upper
      return {
        direction: nearest.direction,
        speedMs: nearest.speed / 3.6
      }
    }
  }

  // Fallback (sollte nicht erreicht werden)
  return { direction: sorted[0].direction, speedMs: sorted[0].speed / 3.6 }
}

/**
 * Berechnet die Landeprognose: Wo kommt der Ballon am Boden an?
 *
 * @param startLat - Aktuelle Breitengrad
 * @param startLon - Aktuelle Längengrad
 * @param startAltitude - Aktuelle Höhe MSL (Meter)
 * @param sinkRate - Sinkrate in m/s (positiver Wert, z.B. 2.0 für 2 m/s Sinken)
 * @param windLayers - Aufgezeichnete Windschichten
 * @param getElevation - Funktion die Bodenhöhe für eine Position liefert
 * @returns LandingPrediction oder null wenn keine Berechnung möglich
 */
export async function calculateLandingPrediction(
  startLat: number,
  startLon: number,
  startAltitude: number,
  sinkRate: number,
  windLayers: WindLayerInput[],
  getElevation: (lat: number, lon: number) => Promise<number | null>
): Promise<LandingPrediction | null> {
  if (windLayers.length === 0 || sinkRate <= 0 || startAltitude <= 0) {
    return null
  }

  // Phase 1: Bodenhöhe am Startpunkt holen (1 IPC-Call)
  const startElev = await getElevation(startLat, startLon)
  let lastGroundElev = startElev ?? 0

  // Phase 2: Simulation synchron durchrechnen, Elevation nur selten per IPC
  const TIME_STEP = 5  // Sekunden pro Simulationsschritt
  const MAX_TIME = 3600  // Max 1 Stunde Simulation
  const PATH_SAMPLE_INTERVAL = 30  // Alle 30 Sekunden einen Pfadpunkt speichern
  const ELEV_CHECK_INTERVAL = 12  // Bodenhöhe alle 12 Schritte (60s) per IPC prüfen

  const path: LandingPredictionPoint[] = []
  let currentLat = startLat
  let currentLon = startLon
  let currentAlt = startAltitude
  let totalTime = 0
  let stepCount = 0

  // Startpunkt
  path.push({
    lat: currentLat,
    lon: currentLon,
    altitude: currentAlt,
    timeSeconds: 0
  })

  while (totalTime < MAX_TIME) {
    // Höhe reduzieren
    currentAlt -= sinkRate * TIME_STEP
    totalTime += TIME_STEP
    stepCount++

    // Wind für aktuelle Höhe interpolieren
    const wind = interpolateWind(currentAlt, windLayers)

    // Ballon driftet MIT dem Wind (Wind kommt AUS direction, Ballon bewegt sich IN direction+180)
    const driftDirection = (wind.direction + 180) % 360
    const driftDistance = wind.speedMs * TIME_STEP  // Meter

    // Neue Position berechnen
    const newPos = calculateDestination(currentLat, currentLon, driftDirection, driftDistance)
    currentLat = newPos.lat
    currentLon = newPos.lon

    // Pfadpunkt speichern (nicht jeden Schritt, nur periodisch)
    if (totalTime % PATH_SAMPLE_INTERVAL === 0) {
      path.push({
        lat: currentLat,
        lon: currentLon,
        altitude: Math.max(0, currentAlt),
        timeSeconds: totalTime
      })
    }

    // Boden-Check: HGT-Elevation nur periodisch per IPC (max alle 60s)
    if (stepCount % ELEV_CHECK_INTERVAL === 0) {
      const groundElev = await getElevation(currentLat, currentLon)
      if (groundElev !== null) lastGroundElev = groundElev
    }

    if (currentAlt <= lastGroundElev) {
      // Phase 3: Finale Bodenhöhe am Landepunkt prüfen (1 IPC-Call)
      const finalElev = await getElevation(currentLat, currentLon)
      if (finalElev !== null) lastGroundElev = finalElev

      const landingPoint: LandingPredictionPoint = {
        lat: currentLat,
        lon: currentLon,
        altitude: lastGroundElev,
        timeSeconds: totalTime
      }

      // Letzten Punkt zum Pfad hinzufügen
      path.push(landingPoint)

      const totalDistance = calculateDistance(startLat, startLon, currentLat, currentLon)

      return {
        path,
        landingPoint,
        groundElevation: lastGroundElev,
        totalTimeSeconds: totalTime,
        totalDistanceMeters: totalDistance
      }
    }
  }

  // Timeout - nach MAX_TIME immer noch nicht gelandet (sehr unwahrscheinlich)
  const landingPoint: LandingPredictionPoint = {
    lat: currentLat,
    lon: currentLon,
    altitude: currentAlt,
    timeSeconds: totalTime
  }
  path.push(landingPoint)

  return {
    path,
    landingPoint,
    groundElevation: lastGroundElev,
    totalTimeSeconds: totalTime,
    totalDistanceMeters: calculateDistance(startLat, startLon, currentLat, currentLon)
  }
}

// ═══════════════════════════════════════════════════════════════════
// Drop Calculator - Wo landet der Marker?
// ═══════════════════════════════════════════════════════════════════

// Physik-Konstanten für FAI-Standard-Marker (70g)
const MARKER_MASS = 0.07       // kg
const MARKER_CD = 1.2          // Drag-Koeffizient (flacher Marker mit Flattern)
const MARKER_AREA = 0.003      // m² effektive Querschnittsfläche
const AIR_DENSITY = 1.225      // kg/m³ (Standardatmosphäre Meereshöhe)
const GRAVITY = 9.81           // m/s²
// Drag-Faktor: 0.5 * ρ * Cd * A (vorberechnet für Performance)
const DRAG_FACTOR = 0.5 * AIR_DENSITY * MARKER_CD * MARKER_AREA

export interface MarkerDropPoint {
  lat: number
  lon: number
  altitude: number  // MSL in Metern
  timeSeconds: number  // Sekunden ab Drop
}

export interface MarkerDropPrediction {
  path: MarkerDropPoint[]          // Fallpfad
  impactPoint: MarkerDropPoint     // Aufschlagpunkt am Boden
  timeToImpact: number             // Sekunden bis Aufschlag
  groundElevation: number          // Bodenhöhe am Aufschlagpunkt (Meter MSL)
  totalDriftMeters: number         // Horizontale Drift Start → Aufschlag
}

/**
 * Berechnet wo ein Marker (FAI-Standard, 70g) am Boden aufschlägt.
 * Physikalisch realistische Simulation mit:
 * - Gravitationsbeschleunigung + Luftwiderstand (vertikale Sinkrate)
 * - Horizontale Trägheit (Marker hat beim Abwurf Ballongeschwindigkeit)
 * - Wind-Drag (Marker nähert sich exponentiell der Windgeschwindigkeit an)
 * - Marker-Aerodynamik (Cd, Querschnittsfläche, Masse)
 *
 * @param startLat - Aktuelle Breitengrad des Ballons
 * @param startLon - Aktuelle Längengrad des Ballons
 * @param startAltitude - Aktuelle Höhe MSL (Meter)
 * @param terminalVelocity - Maximale Sinkrate des Markers in m/s (z.B. 10)
 * @param windLayers - Aufgezeichnete Windschichten
 * @param getElevation - Funktion die Bodenhöhe für eine Position liefert
 * @param balloonSpeedKmh - Horizontalgeschwindigkeit des Ballons beim Abwurf (km/h)
 * @param balloonHeading - Flugrichtung des Ballons beim Abwurf (Grad 0-360)
 * @returns MarkerDropPrediction oder null
 */
export async function calculateMarkerDrop(
  startLat: number,
  startLon: number,
  startAltitude: number,
  terminalVelocity: number,
  windLayers: WindLayerInput[],
  getElevation: (lat: number, lon: number) => Promise<number | null>,
  balloonSpeedKmh: number = 0,
  balloonHeading: number = 0
): Promise<MarkerDropPrediction | null> {
  if (windLayers.length === 0 || terminalVelocity <= 0 || startAltitude <= 0) {
    return null
  }

  // Phase 1: Bodenhöhe am Startpunkt holen (1 IPC-Call)
  const t0 = performance.now()
  const startElev = await getElevation(startLat, startLon)
  const groundElev = startElev ?? 0
  console.log(`[MarkerDrop] startAlt=${Math.round(startAltitude)}m, groundElev=${groundElev}m (startElev IPC: ${Math.round(performance.now() - t0)}ms), termVel=${terminalVelocity}m/s, balloonSpeed=${Math.round(balloonSpeedKmh)}km/h, heading=${Math.round(balloonHeading)}°, layers=${windLayers.length}`)

  // Phase 2: Physik-Simulation
  const TIME_STEP = 0.5  // 0.5s Schritte für Präzision
  const MAX_TIME = 300   // Max 5 Minuten
  const PATH_SAMPLE_INTERVAL = 2  // Jeden 2. Schritt (= jede Sekunde)

  const path: MarkerDropPoint[] = []
  let currentLat = startLat
  let currentLon = startLon
  let currentAlt = startAltitude
  let totalTime = 0
  let stepCount = 0

  // Vertikale Geschwindigkeit: startet bei 0, beschleunigt durch Gravitation
  let vVertical = 0

  // Horizontale Geschwindigkeit: Marker hat beim Abwurf die Ballongeschwindigkeit
  // Heading in Grad → X/Y Komponenten (X=Ost, Y=Nord)
  const balloonSpeedMs = balloonSpeedKmh / 3.6
  const headingRad = balloonHeading * Math.PI / 180
  let vX = balloonSpeedMs * Math.sin(headingRad)  // Ost-Komponente
  let vY = balloonSpeedMs * Math.cos(headingRad)  // Nord-Komponente

  // Startpunkt
  path.push({ lat: currentLat, lon: currentLon, altitude: currentAlt, timeSeconds: 0 })

  while (totalTime < MAX_TIME) {
    totalTime += TIME_STEP
    stepCount++

    // ── Vertikale Physik: Gravitation vs. Luftwiderstand ──
    // Drag-Kraft vertikal: F_drag = DRAG_FACTOR * v²
    const dragForceVertical = DRAG_FACTOR * vVertical * vVertical
    // Beschleunigung: a = g - F_drag/m (Drag bremst, Gravitation beschleunigt)
    const aVertical = GRAVITY - dragForceVertical / MARKER_MASS
    // Geschwindigkeit aktualisieren, max = terminalVelocity
    vVertical = Math.min(vVertical + aVertical * TIME_STEP, terminalVelocity)

    // Höhe reduzieren
    currentAlt -= vVertical * TIME_STEP

    // ── Horizontale Physik: Wind-Drag ──
    // Wind für aktuelle Höhe holen
    const wind = interpolateWind(currentAlt, windLayers)

    // Wind kommt AUS direction → Drift-Richtung = direction + 180°
    const windDriftRad = ((wind.direction + 180) % 360) * Math.PI / 180
    const windVx = wind.speedMs * Math.sin(windDriftRad)  // Wind Ost-Komponente
    const windVy = wind.speedMs * Math.cos(windDriftRad)  // Wind Nord-Komponente

    // Differenzgeschwindigkeit Wind - Marker (horizontaler Drag)
    const dvX = windVx - vX
    const dvY = windVy - vY
    const relSpeed = Math.sqrt(dvX * dvX + dvY * dvY)

    if (relSpeed > 0.001) {
      // Horizontale Drag-Kraft: F = DRAG_FACTOR * relSpeed²
      // Aufgeteilt in X/Y-Richtung proportional zur Differenzgeschwindigkeit
      const dragForceH = DRAG_FACTOR * relSpeed * relSpeed
      const aH = dragForceH / MARKER_MASS  // Beschleunigung Betrag
      // Beschleunigung in X/Y aufteilen (Richtung: von Marker zu Wind)
      const axH = aH * (dvX / relSpeed)
      const ayH = aH * (dvY / relSpeed)
      vX += axH * TIME_STEP
      vY += ayH * TIME_STEP
    }

    // ── Position aktualisieren ──
    // Gesamte horizontale Geschwindigkeit in Bearing + Distanz umrechnen
    const hSpeed = Math.sqrt(vX * vX + vY * vY)
    if (hSpeed > 0.001) {
      const bearing = (Math.atan2(vX, vY) * 180 / Math.PI + 360) % 360
      const distance = hSpeed * TIME_STEP
      const newPos = calculateDestination(currentLat, currentLon, bearing, distance)
      currentLat = newPos.lat
      currentLon = newPos.lon
    }

    // Pfadpunkt speichern (jede Sekunde)
    if (stepCount % PATH_SAMPLE_INTERVAL === 0) {
      path.push({ lat: currentLat, lon: currentLon, altitude: Math.max(0, currentAlt), timeSeconds: totalTime })
    }

    // Boden-Check gegen initiale Bodenhöhe (synchron, kein IPC)
    if (currentAlt <= groundElev) {
      // Phase 3: Finale Bodenhöhe am Aufschlagpunkt prüfen (1 IPC-Call)
      const t1 = performance.now()
      const finalElev = await getElevation(currentLat, currentLon)
      const finalGround = finalElev ?? groundElev
      console.log(`[MarkerDrop] IMPACT: steps=${stepCount}, time=${totalTime.toFixed(1)}s, finalAlt=${Math.round(currentAlt)}m, ground=${finalGround}m, vVert=${vVertical.toFixed(1)}m/s, simTime=${Math.round(performance.now() - t0)}ms, finalIPC=${Math.round(performance.now() - t1)}ms`)

      const impactPoint: MarkerDropPoint = {
        lat: currentLat,
        lon: currentLon,
        altitude: finalGround,
        timeSeconds: totalTime
      }
      path.push(impactPoint)

      return {
        path,
        impactPoint,
        timeToImpact: totalTime,
        groundElevation: finalGround,
        totalDriftMeters: calculateDistance(startLat, startLon, currentLat, currentLon)
      }
    }
  }

  // Timeout
  console.log(`[MarkerDrop] TIMEOUT: steps=${stepCount}, time=${totalTime}s, alt=${Math.round(currentAlt)}m, ground=${groundElev}m - Marker hat Boden nicht erreicht!`)
  const impactPoint: MarkerDropPoint = {
    lat: currentLat, lon: currentLon, altitude: currentAlt, timeSeconds: totalTime
  }
  path.push(impactPoint)

  return {
    path,
    impactPoint,
    timeToImpact: totalTime,
    groundElevation: groundElev,
    totalDriftMeters: calculateDistance(startLat, startLon, currentLat, currentLon)
  }
}

// ═══════════════════════════════════════════════════════════════════
// Steigpunkt-Rechner - Wo muss ich steigen um ans Ziel zu kommen?
// ═══════════════════════════════════════════════════════════════════

export interface ClimbPointResult {
  bestPoint: { lat: number; lon: number; altitude: number; timeSeconds: number }
  distanceToGoal: number       // Meter zum Ziel am besten Punkt
  altitudeChange: number       // Höhenänderung in Metern (positiv=steigen, negativ=sinken)
  climbTime: number            // Reine Steig-/Sinkzeit in Sekunden (Ramp + volle Rate)
  leadTime: number             // Vorlaufzeit in Sekunden (Drift auf aktueller Höhe)
  totalTime: number            // Gesamtzeit (Vorlauf + Steigzeit)
  path: { lat: number; lon: number; altitude: number }[]
}

/**
 * Berechnet den optimalen Steig-/Sinkpunkt um ein Ziel zu erreichen.
 * 3 Phasen: Vorlauf (Drift auf Höhe) → Ramp-Up (0→Rate) → Volle Rate
 *
 * @param startLat - Aktuelle Position
 * @param startLon - Aktuelle Position
 * @param startAltitude - Aktuelle Höhe MSL (Meter)
 * @param climbRate - Steig-/Sinkrate in m/s (positiv=steigen, negativ=sinken)
 * @param minAltitudeChangeFt - Mindest-Höhenänderung in ft (absolut)
 * @param minDistance - Mindest-Horizontaldistanz vom Startpunkt in Metern
 * @param windLayers - Windschichten
 * @param goalLat - Zielposition
 * @param goalLon - Zielposition
 * @param exactMode - Exakte Werte statt besten Punkt suchen
 * @param leadTimeSec - Vorlaufzeit in Sekunden (Drift auf aktueller Höhe)
 * @param rampUpSec - Beschleunigungsphase in Sekunden (0→volle Rate)
 */
export function calculateClimbPoint(
  startLat: number,
  startLon: number,
  startAltitude: number,
  climbRate: number,
  minAltitudeChangeFt: number,
  minDistance: number,
  windLayers: WindLayerInput[],
  goalLat: number,
  goalLon: number,
  exactMode: boolean = false,
  leadTimeSec: number = 0,
  rampUpSec: number = 30
): ClimbPointResult | null {
  if (windLayers.length === 0 || climbRate === 0) return null

  const TIME_STEP = 1  // 1s Schritte
  const MAX_TIME = 3600  // Max 60 Min
  const PATH_SAMPLE_INTERVAL = 10  // Alle 10s einen Pfadpunkt
  const targetAltChangeM = minAltitudeChangeFt * 0.3048

  const path: { lat: number; lon: number; altitude: number }[] = []
  let currentLat = startLat
  let currentLon = startLon
  let currentAlt = startAltitude
  let totalTime = 0
  let climbTimeCounter = 0  // Reine Steig-/Sinkzeit (ab Ende Vorlauf)

  let bestDist = Infinity
  let bestPoint: ClimbPointResult['bestPoint'] | null = null
  let bestPathLength = 0

  // Startpunkt
  path.push({ lat: currentLat, lon: currentLon, altitude: currentAlt })

  // ── Phase 1: Vorlauf – Drift auf aktueller Höhe ──
  for (let t = 0; t < leadTimeSec; t++) {
    totalTime++
    const wind = interpolateWind(currentAlt, windLayers)
    const driftDirection = (wind.direction + 180) % 360
    const driftDistance = wind.speedMs * TIME_STEP
    const newPos = calculateDestination(currentLat, currentLon, driftDirection, driftDistance)
    currentLat = newPos.lat
    currentLon = newPos.lon

    if (totalTime % PATH_SAMPLE_INTERVAL === 0) {
      path.push({ lat: currentLat, lon: currentLon, altitude: currentAlt })
    }
  }

  // Position nach Vorlauf merken (ab hier zählt Höhenänderung)
  const climbStartAlt = currentAlt
  const climbStartLat = currentLat
  const climbStartLon = currentLon

  // ── Phase 2+3: Ramp-Up + Volle Rate ──
  while (totalTime < MAX_TIME) {
    climbTimeCounter++
    totalTime++

    // Effektive Rate: Ramp-Up oder volle Rate
    let effectiveRate: number
    if (climbTimeCounter <= rampUpSec) {
      // Lineare Beschleunigung: 0 → climbRate über rampUpSec
      effectiveRate = climbRate * (climbTimeCounter / rampUpSec)
    } else {
      effectiveRate = climbRate
    }

    currentAlt += effectiveRate * TIME_STEP

    // Nicht unter 0m oder über 10000m
    if (currentAlt < 0 || currentAlt > 10000) break

    // Wind für aktuelle Höhe interpolieren
    const wind = interpolateWind(currentAlt, windLayers)
    const driftDirection = (wind.direction + 180) % 360
    const driftDistance = wind.speedMs * TIME_STEP
    const newPos = calculateDestination(currentLat, currentLon, driftDirection, driftDistance)
    currentLat = newPos.lat
    currentLon = newPos.lon

    if (totalTime % PATH_SAMPLE_INTERVAL === 0) {
      path.push({ lat: currentLat, lon: currentLon, altitude: currentAlt })
    }

    // Mindestbedingungen prüfen (Höhenänderung ab Steig-Start)
    const altChange = Math.abs(currentAlt - climbStartAlt)
    const horizontalDist = calculateDistance(climbStartLat, climbStartLon, currentLat, currentLon)

    if (exactMode) {
      if (altChange >= targetAltChangeM && horizontalDist >= minDistance) {
        bestPoint = {
          lat: currentLat,
          lon: currentLon,
          altitude: currentAlt,
          timeSeconds: totalTime
        }
        bestDist = calculateDistance(currentLat, currentLon, goalLat, goalLon)
        path.push({ lat: currentLat, lon: currentLon, altitude: currentAlt })
        bestPathLength = path.length
        break
      }
    } else {
      if (altChange >= targetAltChangeM && horizontalDist >= minDistance) {
        const distToGoal = calculateDistance(currentLat, currentLon, goalLat, goalLon)
        if (distToGoal < bestDist) {
          bestDist = distToGoal
          bestPoint = {
            lat: currentLat,
            lon: currentLon,
            altitude: currentAlt,
            timeSeconds: totalTime
          }
          bestPathLength = path.length
          if (totalTime % PATH_SAMPLE_INTERVAL !== 0) {
            path.push({ lat: currentLat, lon: currentLon, altitude: currentAlt })
            bestPathLength = path.length
          }
        } else if (bestPoint && distToGoal > bestDist * 1.5) {
          break
        }
      }
    }
  }

  if (!bestPoint) return null

  const finalPath = path.slice(0, bestPathLength)

  return {
    bestPoint,
    distanceToGoal: Math.round(bestDist),
    altitudeChange: Math.round(bestPoint.altitude - climbStartAlt),
    climbTime: climbTimeCounter,
    leadTime: leadTimeSec,
    totalTime: totalTime,
    path: finalPath
  }
}

// ═══════════════════════════════════════════════════════════════════
// Land Run Rechner - Optimales Dreieck aus Windschichten
// ═══════════════════════════════════════════════════════════════════

export interface LandRunOption {
  leg1Altitude: number
  leg2Altitude: number
  leg1Wind: { direction: number; speedKmh: number }
  leg2Wind: { direction: number; speedKmh: number }
  angleDifference: number
  triangleArea: number
  leg1Distance: number  // Distanz A→B in Metern
  leg2Distance: number  // Distanz B→C in Metern
  leg1Time: number      // Zeit A→B in Sekunden
  leg2Time: number      // Zeit B→C in Sekunden
  pointA: { lat: number; lon: number }
  pointB: { lat: number; lon: number }
  pointC: { lat: number; lon: number }
  pathAB: { lat: number; lon: number }[]
  pathBC: { lat: number; lon: number }[]
  approachPath: { lat: number; lon: number }[]
  approachTime: number
  totalTime: number
}

export interface LandRunResult {
  best: LandRunOption
  alternatives: LandRunOption[]
}

export interface MapBoundsCheck {
  north: number
  south: number
  east: number
  west: number
}

// Limit-Konfiguration für Land Run Legs
export interface LandRunLimits {
  // Modus: was wird begrenzt?
  mode: 'leg1' | 'leg2' | 'leg1+leg2' | 'total'
  // 'leg1' = nur Leg 1 hat ein Limit, Leg 2 = gleiche Dauer
  // 'leg2' = nur Leg 2 hat ein Limit, Leg 1 = gleiche Dauer
  // 'leg1+leg2' = Leg 1 und Leg 2 haben separate Limits
  // 'total' = Gesamtzeit A→C (aufgeteilt: Leg1 + Transition + Leg2)

  // Einheit
  unit: 'min' | 'km'

  // Werte
  leg1Value: number   // Limit für Leg 1 (Min oder km)
  leg2Value: number   // Limit für Leg 2 (Min oder km), nur bei 'leg1+leg2'
  totalValue: number  // Gesamt-Limit (Min oder km), nur bei 'total'
}

/**
 * Berechnet den optimalen Land Run (LRN Task).
 *
 * Punkt A = Position wo der Pilot nach dem Steigen/Sinken von seiner aktuellen
 * Position auf leg1Alt ankommt (mit Wind-Drift während des Steigens).
 *
 * Limits sind flexibel konfigurierbar:
 * - 'leg1': Leg 1 hat ein Limit, Leg 2 bekommt gleiche Dauer
 * - 'leg2': Leg 2 hat ein Limit, Leg 1 bekommt gleiche Dauer
 * - 'leg1+leg2': Separate Limits für Leg 1 und Leg 2
 * - 'total': Gesamtlimit A→C (wird auf Legs aufgeteilt)
 * - Einheit: Minuten oder Kilometer
 */
export function calculateLandRun(
  pilotLat: number,
  pilotLon: number,
  pilotAltitude: number,
  climbRate: number,
  windLayers: WindLayerInput[],
  limits: LandRunLimits,
  mapBounds?: MapBoundsCheck | null
): LandRunResult | null {
  if (windLayers.length < 2) return null

  const TIME_STEP = 1 // 1s
  const PATH_SAMPLE_INTERVAL = 10

  // Bounds-Check Funktion
  const isInBounds = (lat: number, lon: number): boolean => {
    if (!mapBounds) return true
    return lat >= mapBounds.south && lat <= mapBounds.north &&
           lon >= mapBounds.west && lon <= mapBounds.east
  }

  // Alle unterschiedlichen Höhen aus den Windschichten
  const sorted = [...windLayers].sort((a, b) => a.altitude - b.altitude)
  const altitudes = sorted.map(l => l.altitude)

  const allOptions: LandRunOption[] = []

  // Jede Kombination von Leg1-Höhe und Leg2-Höhe probieren
  for (let i = 0; i < altitudes.length; i++) {
    for (let j = 0; j < altitudes.length; j++) {
      if (i === j) continue

      const leg1Alt = altitudes[i]
      const leg2Alt = altitudes[j]

      const leg1Wind = interpolateWind(leg1Alt, windLayers)
      const leg2Wind = interpolateWind(leg2Alt, windLayers)

      if (leg1Wind.speedMs < 0.1 && leg2Wind.speedMs < 0.1) continue

      // Höhenwechsel-Zeit (Transition) B → Leg2-Höhe
      const transitionTimeSec = Math.abs(leg2Alt - leg1Alt) / climbRate

      // ═══ Leg-Zeiten berechnen basierend auf Limits ═══
      // WICHTIG: Leg 2 Zeit zählt ab Punkt B (Marker drop), INKLUSIVE Höhenwechsel!
      // D.h. leg2MaxTimeSec beinhaltet Transition + Drift auf leg2Alt.
      let leg1MaxTimeSec: number
      let leg2MaxTimeSec: number  // Gesamtzeit ab B (inkl. Transition)
      let leg1MaxDistM: number | null = null
      let leg2MaxDistM: number | null = null  // Gesamt-Distanz B→C (inkl. Transition-Drift)

      if (limits.unit === 'km') {
        if (limits.mode === 'leg1') {
          leg1MaxDistM = limits.leg1Value * 1000
          leg2MaxDistM = limits.leg1Value * 1000
          leg1MaxTimeSec = leg1Wind.speedMs > 0.1 ? leg1MaxDistM / leg1Wind.speedMs : 3600
          leg2MaxTimeSec = 3600 // wird durch Distanz-Check gestoppt
        } else if (limits.mode === 'leg2') {
          leg1MaxDistM = limits.leg2Value * 1000
          leg2MaxDistM = limits.leg2Value * 1000
          leg1MaxTimeSec = leg1Wind.speedMs > 0.1 ? leg1MaxDistM / leg1Wind.speedMs : 3600
          leg2MaxTimeSec = 3600
        } else if (limits.mode === 'leg1+leg2') {
          leg1MaxDistM = limits.leg1Value * 1000
          leg2MaxDistM = limits.leg2Value * 1000
          leg1MaxTimeSec = leg1Wind.speedMs > 0.1 ? leg1MaxDistM / leg1Wind.speedMs : 3600
          leg2MaxTimeSec = 3600
        } else {
          // total: Gesamt-Distanz aufteilen
          const totalDistM = limits.totalValue * 1000
          leg1MaxDistM = totalDistM / 2
          leg2MaxDistM = totalDistM / 2
          leg1MaxTimeSec = 3600
          leg2MaxTimeSec = 3600
        }
      } else {
        // Zeit-Limits (Minuten)
        // Leg 2 Zeit beinhaltet Transition!
        if (limits.mode === 'leg1') {
          leg1MaxTimeSec = limits.leg1Value * 60
          leg2MaxTimeSec = limits.leg1Value * 60  // gleiche Dauer (inkl. Transition)
        } else if (limits.mode === 'leg2') {
          leg1MaxTimeSec = limits.leg2Value * 60  // gleiche Dauer
          leg2MaxTimeSec = limits.leg2Value * 60  // inkl. Transition
        } else if (limits.mode === 'leg1+leg2') {
          leg1MaxTimeSec = limits.leg1Value * 60
          leg2MaxTimeSec = limits.leg2Value * 60  // inkl. Transition
        } else {
          // total: Gesamtzeit aufteilen
          const totalSec = limits.totalValue * 60
          leg1MaxTimeSec = totalSec / 2
          leg2MaxTimeSec = totalSec / 2  // inkl. Transition
        }
      }

      // ═══ Anflug: Steigen/Sinken von pilotAltitude auf leg1Alt ═══
      const approachPath: { lat: number; lon: number }[] = [{ lat: pilotLat, lon: pilotLon }]
      let apLat = pilotLat
      let apLon = pilotLon
      let apAlt = pilotAltitude
      let approachTime = 0

      const approachClimbDir = leg1Alt > pilotAltitude ? 1 : -1
      const approachDuration = Math.abs(leg1Alt - pilotAltitude) / climbRate

      let at = 0
      while (at < approachDuration) {
        apAlt += approachClimbDir * climbRate * TIME_STEP
        approachTime += TIME_STEP
        at += TIME_STEP

        const wind = interpolateWind(apAlt, windLayers)
        const driftDir = (wind.direction + 180) % 360
        const driftDist = wind.speedMs * TIME_STEP
        const newPos = calculateDestination(apLat, apLon, driftDir, driftDist)
        apLat = newPos.lat
        apLon = newPos.lon

        if (approachTime % PATH_SAMPLE_INTERVAL === 0) {
          approachPath.push({ lat: apLat, lon: apLon })
        }
      }
      approachPath.push({ lat: apLat, lon: apLon })

      // Punkt A = Position nach dem Steigen auf leg1Alt
      const pointA = { lat: apLat, lon: apLon }
      if (!isInBounds(pointA.lat, pointA.lon)) continue

      // ═══ Phase 1: Leg 1 auf leg1Alt ═══
      const pathAB: { lat: number; lon: number }[] = [{ ...pointA }]
      let currentLat = pointA.lat
      let currentLon = pointA.lon
      let currentAlt = leg1Alt
      let runTime = 0
      let outOfBounds = false

      const drift1Dir = (leg1Wind.direction + 180) % 360
      let t = 0
      while (t < leg1MaxTimeSec) {
        runTime += TIME_STEP
        t += TIME_STEP

        const driftDist = leg1Wind.speedMs * TIME_STEP
        const newPos = calculateDestination(currentLat, currentLon, drift1Dir, driftDist)
        currentLat = newPos.lat
        currentLon = newPos.lon

        if (!isInBounds(currentLat, currentLon)) { outOfBounds = true; break }

        // Distanz-Check für Leg 1
        if (leg1MaxDistM !== null) {
          const dist = calculateDistance(pointA.lat, pointA.lon, currentLat, currentLon)
          if (dist >= leg1MaxDistM) break
        }

        if (t % PATH_SAMPLE_INTERVAL === 0) {
          pathAB.push({ lat: currentLat, lon: currentLon })
        }
      }

      if (outOfBounds) continue

      const pointB = { lat: currentLat, lon: currentLon }
      const leg1ActualTime = t
      const leg1ActualDist = calculateDistance(pointA.lat, pointA.lon, pointB.lat, pointB.lon)
      pathAB.push({ ...pointB })

      // ═══ Phase 2+3: Leg 2 ab Punkt B (Marker drop) ═══
      // Zeit zählt ab B! Erst Höhenwechsel (Transition), dann Drift auf leg2Alt.
      // Beides zusammen = Leg 2 Gesamtzeit.
      const pathBC: { lat: number; lon: number }[] = [{ ...pointB }]
      const climbDir = leg2Alt > leg1Alt ? 1 : -1
      currentAlt = leg1Alt
      const drift2Dir = (leg2Wind.direction + 180) % 360
      let transitioning = true  // Noch im Höhenwechsel?
      t = 0
      while (t < leg2MaxTimeSec) {
        runTime += TIME_STEP
        t += TIME_STEP

        if (transitioning) {
          // Noch im Höhenwechsel: Steigen/Sinken + Wind auf aktueller Höhe
          currentAlt += climbDir * climbRate * TIME_STEP

          // Prüfe ob Zielhöhe erreicht
          if ((climbDir > 0 && currentAlt >= leg2Alt) || (climbDir < 0 && currentAlt <= leg2Alt)) {
            currentAlt = leg2Alt
            transitioning = false
          }

          // Wind auf aktueller Höhe (interpoliert während Transition)
          const wind = interpolateWind(currentAlt, windLayers)
          const driftDir = (wind.direction + 180) % 360
          const driftDist = wind.speedMs * TIME_STEP
          const newPos = calculateDestination(currentLat, currentLon, driftDir, driftDist)
          currentLat = newPos.lat
          currentLon = newPos.lon
        } else {
          // Auf leg2Alt: Drift mit leg2Wind
          const driftDist = leg2Wind.speedMs * TIME_STEP
          const newPos = calculateDestination(currentLat, currentLon, drift2Dir, driftDist)
          currentLat = newPos.lat
          currentLon = newPos.lon
        }

        if (!isInBounds(currentLat, currentLon)) { outOfBounds = true; break }

        // Distanz-Check für Leg 2 (Gesamt-Distanz ab B, inkl. Transition-Drift)
        if (leg2MaxDistM !== null) {
          const dist = calculateDistance(pointB.lat, pointB.lon, currentLat, currentLon)
          if (dist >= leg2MaxDistM) break
        }

        if (t % PATH_SAMPLE_INTERVAL === 0) {
          pathBC.push({ lat: currentLat, lon: currentLon })
        }
      }

      if (outOfBounds) continue

      const pointC = { lat: currentLat, lon: currentLon }
      const leg2ActualTime = t  // Gesamtzeit ab B (inkl. Transition)
      const leg2ActualDist = calculateDistance(pointB.lat, pointB.lon, pointC.lat, pointC.lon)
      pathBC.push({ ...pointC })

      // Dreiecksfläche berechnen (Kreuzprodukt)
      const cosLat = Math.cos(pointA.lat * Math.PI / 180)
      const dBLat = (pointB.lat - pointA.lat) * 111320
      const dBLon = (pointB.lon - pointA.lon) * 111320 * cosLat
      const dCLat = (pointC.lat - pointA.lat) * 111320
      const dCLon = (pointC.lon - pointA.lon) * 111320 * cosLat

      const area = Math.abs(dBLat * dCLon - dBLon * dCLat) / 2

      // Winkel zwischen den Drift-Richtungen
      let angleDiff = Math.abs(drift1Dir - drift2Dir)
      if (angleDiff > 180) angleDiff = 360 - angleDiff

      allOptions.push({
        leg1Altitude: leg1Alt,
        leg2Altitude: leg2Alt,
        leg1Wind: { direction: Math.round(leg1Wind.direction), speedKmh: Math.round(leg1Wind.speedMs * 3.6 * 10) / 10 },
        leg2Wind: { direction: Math.round(leg2Wind.direction), speedKmh: Math.round(leg2Wind.speedMs * 3.6 * 10) / 10 },
        angleDifference: Math.round(angleDiff),
        triangleArea: Math.round(area),
        leg1Distance: Math.round(leg1ActualDist),
        leg2Distance: Math.round(leg2ActualDist),
        leg1Time: leg1ActualTime,
        leg2Time: leg2ActualTime,
        pointA,
        pointB,
        pointC,
        pathAB,
        pathBC,
        approachPath,
        approachTime,
        totalTime: runTime
      })
    }
  }

  if (allOptions.length === 0) return null

  allOptions.sort((a, b) => b.triangleArea - a.triangleArea)

  return {
    best: allOptions[0],
    alternatives: allOptions.slice(1, 6)
  }
}

/**
 * Konvertiert UTM Koordinaten zu WGS84
 * (Vereinfachte Version)
 */
export function utmToLatLon(
  easting: number,
  northing: number,
  zone: number,
  isNorthernHemisphere: boolean = true
): { lat: number; lon: number } {
  // Vereinfachte Konvertierung - für genaue Ergebnisse
  // sollte eine vollständige Implementierung verwendet werden
  const k0 = 0.9996
  const a = 6378137 // WGS84 major axis
  const e = 0.081819190842622 // WGS84 eccentricity

  const x = easting - 500000
  const y = isNorthernHemisphere ? northing : northing - 10000000

  const m = y / k0
  const mu = m / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64))

  // Weitere Berechnungen würden hier folgen...
  // Dies ist eine vereinfachte Placeholder-Implementierung

  return {
    lat: 0,
    lon: 0
  }
}

// ═══════════════════════════════════════════════════════════════════
// Angle Task Rechner - Optimaler Winkel aus Windschichten
// Leg 1 = vorgegebene Richtung (setDirection), Leg 2 = beste Abweichung
// ═══════════════════════════════════════════════════════════════════

export interface AngleTaskOption {
  leg1Altitude: number          // Höhe Leg 1 (Meter) — Drift in setDirection
  leg2Altitude: number          // Höhe Leg 2 (Meter) — maximale Abweichung
  leg1Wind: { direction: number; speedKmh: number }
  leg2Wind: { direction: number; speedKmh: number }
  leg1DriftDir: number          // Tatsächliche Drift-Richtung auf Leg1 (°)
  leg1Deviation: number         // Abweichung der Leg1-Drift von setDirection (°)
  achievedAngle: number         // Erreichter Winkel (0-180°)
  bearingAtoB: number           // Tatsächlicher Bearing A→B
  distanceAB: number            // Distanz A→B in Metern
  leg1Distance: number          // Distanz Start→A in Metern
  pointA: { lat: number; lon: number }
  pointB: { lat: number; lon: number }
  pathLeg1: { lat: number; lon: number }[]     // Drift-Pfad Start→A (Leg 1 = setDirection)
  pathLeg2: { lat: number; lon: number }[]     // Drift-Pfad A→B (Leg 2 = Abweichung)
  approachPath: { lat: number; lon: number }[] // Anflug (Pilot → Leg1-Höhe)
  approachTime: number          // Anflugzeit in Sekunden
  leg1Time: number              // Leg1 Zeit in Sekunden
  leg2Time: number              // Leg2 Zeit in Sekunden (bis B erreicht)
  totalTime: number             // Gesamtzeit
}

export interface AngleTaskResult {
  best: AngleTaskOption
  alternatives: AngleTaskOption[]
}

export function calculateAngleTask(
  pilotLat: number,
  pilotLon: number,
  pilotAltitude: number,
  climbRate: number,
  windLayers: WindLayerInput[],
  setDirection: number,
  minDistanceM: number,         // Min A→B in Metern (nur bei km-Modus relevant)
  maxDistanceM: number,         // Max A→B in Metern (nur bei km-Modus relevant)
  limitMode: 'km' | 'min',     // km = Distanz-Limit, min = Zeit-Limit
  minTimeSec: number,           // Min Zeit A→B in Sekunden (nur bei min-Modus relevant)
  maxTimeSec: number,           // Max Zeit A→B in Sekunden (nur bei min-Modus relevant)
  mapBounds?: MapBoundsCheck | null,
  fixedPointA?: { lat: number; lon: number } | null  // Manuell eingegebener Punkt A
): AngleTaskResult | null {
  if (windLayers.length < 2) return null

  const TIME_STEP = 1
  const PATH_SAMPLE_INTERVAL = 10
  const MAX_TIME = 3600 // Max 1h

  const isInBounds = (lat: number, lon: number): boolean => {
    if (!mapBounds) return true
    return lat >= mapBounds.south && lat <= mapBounds.north &&
           lon >= mapBounds.west && lon <= mapBounds.east
  }

  const sorted = [...windLayers].sort((a, b) => a.altitude - b.altitude)
  const altitudes = sorted.map(l => l.altitude)

  const allOptions: AngleTaskOption[] = []

  for (let i = 0; i < altitudes.length; i++) {
    const leg1Alt = altitudes[i]
    const leg1Wind = interpolateWind(leg1Alt, windLayers)

    if (leg1Wind.speedMs < 0.1) continue

    // Drift-Richtung auf Leg 1 Höhe
    const drift1Dir = (leg1Wind.direction + 180) % 360

    let leg1Dev = Math.abs(drift1Dir - setDirection)
    if (leg1Dev > 180) leg1Dev = 360 - leg1Dev

    // ═══ Punkt A bestimmen ═══
    let pointA: { lat: number; lon: number }
    let approachPath: { lat: number; lon: number }[]
    let approachTime: number

    if (fixedPointA) {
      // Manuell eingegebener Punkt A — kein Anflug nötig
      pointA = { lat: fixedPointA.lat, lon: fixedPointA.lon }
      approachPath = []
      approachTime = 0
    } else {
      // Anflug: Steigen/Sinken von pilotAltitude auf leg1Alt
      approachPath = [{ lat: pilotLat, lon: pilotLon }]
      let apLat = pilotLat
      let apLon = pilotLon
      let apAlt = pilotAltitude
      approachTime = 0

      const approachClimbDir = leg1Alt > pilotAltitude ? 1 : -1
      const approachDuration = Math.abs(leg1Alt - pilotAltitude) / climbRate

      let at = 0
      while (at < approachDuration) {
        apAlt += approachClimbDir * climbRate * TIME_STEP
        approachTime += TIME_STEP
        at += TIME_STEP

        const wind = interpolateWind(apAlt, windLayers)
        const driftDir = (wind.direction + 180) % 360
        const driftDist = wind.speedMs * TIME_STEP
        const newPos = calculateDestination(apLat, apLon, driftDir, driftDist)
        apLat = newPos.lat
        apLon = newPos.lon

        if (approachTime % PATH_SAMPLE_INTERVAL === 0) {
          approachPath.push({ lat: apLat, lon: apLon })
        }
      }
      approachPath.push({ lat: apLat, lon: apLon })
      pointA = { lat: apLat, lon: apLon }
    }

    if (!isInBounds(pointA.lat, pointA.lon)) continue

    // Leg 1 Pfad zeigt die Set-Direction-Linie ab Punkt A (visuell)
    const pathLeg1: { lat: number; lon: number }[] = [{ ...pointA }]

    // ═══ Leg 2: Für jede andere Höhe probieren ═══
    for (let j = 0; j < altitudes.length; j++) {
      const leg2Alt = altitudes[j]
      const leg2Wind = interpolateWind(leg2Alt, windLayers)

      if (leg2Wind.speedMs < 0.1) continue

      const drift2Dir = (leg2Wind.direction + 180) % 360

      // Abweichung berechnen (keine Mindest-Toleranz — jeder Winkel zählt)
      let leg2Deviation = Math.abs(drift2Dir - setDirection)
      if (leg2Deviation > 180) leg2Deviation = 360 - leg2Deviation

      const pathLeg2: { lat: number; lon: number }[] = [{ ...pointA }]
      const climbDir = leg2Alt > leg1Alt ? 1 : -1
      let curLat = pointA.lat
      let curLon = pointA.lon
      let curAlt = leg1Alt
      let transitioning = leg1Alt !== leg2Alt
      let bestBInRange: { lat: number; lon: number; dist: number; time: number; angle?: number } | null = null
      let leg2OutOfBounds = false

      const leg2TimeLimit = limitMode === 'min' ? maxTimeSec : MAX_TIME

      let t = 0
      let leg2RunTime = 0
      while (t < leg2TimeLimit) {
        leg2RunTime += TIME_STEP
        t += TIME_STEP

        if (transitioning) {
          curAlt += climbDir * climbRate * TIME_STEP
          if ((climbDir > 0 && curAlt >= leg2Alt) || (climbDir < 0 && curAlt <= leg2Alt)) {
            curAlt = leg2Alt
            transitioning = false
          }
          const wind = interpolateWind(curAlt, windLayers)
          const driftDir = (wind.direction + 180) % 360
          const driftDist = wind.speedMs * TIME_STEP
          const newPos = calculateDestination(curLat, curLon, driftDir, driftDist)
          curLat = newPos.lat
          curLon = newPos.lon
        } else {
          const driftDist = leg2Wind.speedMs * TIME_STEP
          const newPos = calculateDestination(curLat, curLon, drift2Dir, driftDist)
          curLat = newPos.lat
          curLon = newPos.lon
        }

        if (!isInBounds(curLat, curLon)) { leg2OutOfBounds = true; break }

        const dist = calculateDistance(pointA.lat, pointA.lon, curLat, curLon)

        if (limitMode === 'km') {
          // Distanz-Modus: B muss in min/max Range liegen
          if (dist >= minDistanceM && dist <= maxDistanceM) {
            bestBInRange = { lat: curLat, lon: curLon, dist, time: t }
          }
          if (dist > maxDistanceM) break
        } else {
          // Zeit-Modus: B = Position mit dem besten Winkel innerhalb min/max Zeit
          if (t >= minTimeSec) {
            const curBearing = calculateBearing(pointA.lat, pointA.lon, curLat, curLon)
            let curAngle = Math.abs(curBearing - setDirection)
            if (curAngle > 180) curAngle = 360 - curAngle
            if (!bestBInRange || curAngle > (bestBInRange.angle ?? 0)) {
              bestBInRange = { lat: curLat, lon: curLon, dist, time: t, angle: curAngle }
            }
          }
        }

        if (t % PATH_SAMPLE_INTERVAL === 0) {
          pathLeg2.push({ lat: curLat, lon: curLon })
        }
      }

      if (leg2OutOfBounds) continue
      if (!bestBInRange) continue

      const pointB = { lat: bestBInRange.lat, lon: bestBInRange.lon }
      // Im Zeit-Modus: Pfad nur bis zum besten Punkt (nicht darüber hinaus)
      if (limitMode === 'min') {
        const bestTime = bestBInRange.time
        // Pfadpunkte nach bestTime entfernen (PATH_SAMPLE_INTERVAL basiert)
        while (pathLeg2.length > 1) {
          const lastIdx = (pathLeg2.length - 1) * PATH_SAMPLE_INTERVAL
          if (lastIdx > bestTime) pathLeg2.pop()
          else break
        }
      }
      pathLeg2.push({ ...pointB })

      // ═══ Winkel berechnen ═══
      const bearingAtoB = calculateBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon)
      let angleDiff = Math.abs(bearingAtoB - setDirection)
      if (angleDiff > 180) angleDiff = 360 - angleDiff

      allOptions.push({
        leg1Altitude: leg1Alt,
        leg2Altitude: leg2Alt,
        leg1Wind: { direction: Math.round(leg1Wind.direction), speedKmh: Math.round(leg1Wind.speedMs * 3.6 * 10) / 10 },
        leg2Wind: { direction: Math.round(leg2Wind.direction), speedKmh: Math.round(leg2Wind.speedMs * 3.6 * 10) / 10 },
        leg1DriftDir: Math.round(drift1Dir),
        leg1Deviation: Math.round(leg1Dev),
        achievedAngle: Math.round(angleDiff),
        bearingAtoB: Math.round(bearingAtoB),
        distanceAB: Math.round(bestBInRange.dist),
        leg1Distance: 0,
        pointA,
        pointB,
        pathLeg1,
        pathLeg2,
        approachPath,
        approachTime,
        leg1Time: 0,
        leg2Time: bestBInRange.time,
        totalTime: approachTime + bestBInRange.time
      })
    }
  }

  if (allOptions.length === 0) return null

  // Sortiere nach größtem Winkel (bestes Ergebnis zuerst)
  allOptions.sort((a, b) => b.achievedAngle - a.achievedAngle)

  return {
    best: allOptions[0],
    alternatives: allOptions.slice(1, 6)
  }
}
