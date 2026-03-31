/**
 * PDG/FON Rechner V3 – Komplett neu geschrieben
 *
 * Architektur:
 * 1. simulateFlight() – Kern-Simulation: Eine Rate → Endpunkt
 * 2. findOptimalRate() – 3-stufige Suche mit Sensitivitätsanalyse
 * 3. calculateLiveCorrection() – Leichtgewichtige Live-Korrektur
 *
 * Phasen im Flug:
 * - Vorlauf (30s): Drift auf aktueller Höhe, kein Steigen/Sinken
 * - Ramp-Up (30s): Rate steigt linear von 0 auf Zielrate
 * - Volle Rate: Konstante Rate bis Höhenfenster erreicht
 */

import { calculateDistance, calculateDestination, calculateBearing, interpolateWind } from './navigation'

// ═══════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════

export interface WindLayer {
  altitude: number  // Meter MSL
  direction: number // Grad (woher der Wind kommt)
  speed: number     // km/h
}

export interface PdgFonInput {
  // Pilot
  lat: number
  lon: number
  altitude: number  // Meter MSL
  // Ziel (Goal auf der Karte)
  goalLat: number
  goalLon: number
  // Parameter
  direction: 'up' | 'down'
  minAltFt: number   // Relative Mindest-Höhenänderung (ft)
  maxAltFt: number   // Absolute Maximalhöhe (ft), 0 = kein Limit
  minDistM: number   // Mindest-Horizontaldistanz (m)
  // Wind
  windLayers: WindLayer[]
}

export interface PdgFonResult {
  // Optimaler Punkt
  rate: number       // m/s (positiv=steigen, negativ=sinken)
  point: { lat: number; lon: number; altitude: number }
  distToGoal: number // Meter
  altChange: number  // Meter
  flightTime: number // Sekunden (inkl. Vorlauf)
  // Qualität
  sensitivity: number // Meter Verschiebung bei ±0.1 m/s
  score: number       // 0-1 (höher = besser)
  // Visualisierung
  path: { lat: number; lon: number; altitude: number }[]
}

export interface PdgFonCorrection {
  rate: number          // Was du JETZT machen musst (m/s)
  distToGoal: number    // Aktuelle Distanz zum Ziel (m)
  predictedMiss: number // Wo du landest wenn du so weitermachst (m)
  altDiff: number       // Noch fehlende Höhe (m)
  timeRemaining: number // Geschätzte verbleibende Zeit (s)
}

// ═══════════════════════════════════════════════════════════════════
// Konstanten
// ═══════════════════════════════════════════════════════════════════

const LEAD_TIME = 30    // Sekunden Vorlaufzeit
const RAMP_UP = 30      // Sekunden Beschleunigungsphase
const MAX_SIM_TIME = 3600
const PATH_INTERVAL = 10

// ═══════════════════════════════════════════════════════════════════
// Kern-Simulation: Eine Rate → Endpunkt
// ═══════════════════════════════════════════════════════════════════

interface SimResult {
  endLat: number
  endLon: number
  endAlt: number
  endTime: number
  distToGoal: number
  path: { lat: number; lon: number; altitude: number }[]
}

/**
 * Simuliert einen kompletten Flug mit einer festen Rate.
 * @param collectPath - Pfad-Punkte sammeln (langsamer, nur für finale Visualisierung)
 */
function simulateFlight(
  startLat: number, startLon: number, startAlt: number,
  rate: number,  // m/s (positiv=steigen, negativ=sinken)
  windLayers: WindLayer[],
  goalLat: number, goalLon: number,
  minTargetAltM: number, maxTargetAltM: number,
  minDistM: number,
  direction: 'up' | 'down',
  includeLeadTime: boolean = true,
  collectPath: boolean = false
): SimResult | null {
  let lat = startLat, lon = startLon, alt = startAlt
  const path: { lat: number; lon: number; altitude: number }[] = []
  if (collectPath) path.push({ lat, lon, altitude: alt })

  let totalTime = 0

  // Phase 1: Vorlauf (30s Drift auf aktueller Höhe)
  if (includeLeadTime) {
    for (let t = 1; t <= LEAD_TIME; t++) {
      totalTime++
      const wind = interpolateWind(alt, windLayers)
      const newPos = calculateDestination(lat, lon, (wind.direction + 180) % 360, wind.speedMs)
      lat = newPos.lat; lon = newPos.lon
      if (collectPath && t % PATH_INTERVAL === 0) path.push({ lat, lon, altitude: alt })
    }
  }

  // Phase 2+3: Ramp-Up + Volle Rate
  let bestDist = Infinity
  let bestLat = lat, bestLon = lon, bestAlt = alt, bestTime = totalTime

  for (let t = 1; t <= MAX_SIM_TIME; t++) {
    totalTime++

    // Effektive Rate: Ramp-Up oder volle Rate
    const effRate = t <= RAMP_UP ? rate * (t / RAMP_UP) : rate
    alt += effRate

    // Höhengrenzen
    if (direction === 'up' && alt > maxTargetAltM * 1.05) break
    if (direction === 'down' && alt < maxTargetAltM * 0.95) break
    if (alt < 0 || alt > 10000) break

    // Wind-Drift
    const wind = interpolateWind(alt, windLayers)
    const newPos = calculateDestination(lat, lon, (wind.direction + 180) % 360, wind.speedMs)
    lat = newPos.lat; lon = newPos.lon

    if (collectPath && totalTime % PATH_INTERVAL === 0) path.push({ lat, lon, altitude: alt })

    // Im Höhenfenster?
    const inWindow = direction === 'up'
      ? (alt >= minTargetAltM && alt <= maxTargetAltM)
      : (alt <= minTargetAltM && alt >= maxTargetAltM)

    if (inWindow) {
      // Mindestdistanz prüfen
      const hDist = calculateDistance(startLat, startLon, lat, lon)
      if (hDist < minDistM) continue

      // Distanz zum Ziel + Höhen-Penalty (bevorzugt Punkte nahe Min-Höhe)
      const distToGoal = calculateDistance(lat, lon, goalLat, goalLon)
      const altOvershoot = Math.abs(alt - minTargetAltM)
      const effectiveDist = distToGoal + altOvershoot * 0.5

      if (effectiveDist < bestDist) {
        bestDist = effectiveDist
        bestLat = lat; bestLon = lon; bestAlt = alt; bestTime = totalTime
        if (collectPath && totalTime % PATH_INTERVAL !== 0) path.push({ lat, lon, altitude: alt })
      } else if (effectiveDist > bestDist * 1.5) {
        break
      }
    }
  }

  if (bestDist === Infinity) return null

  const realDist = calculateDistance(bestLat, bestLon, goalLat, goalLon)
  return {
    endLat: bestLat, endLon: bestLon, endAlt: bestAlt, endTime: bestTime,
    distToGoal: realDist,
    path: collectPath ? path : []
  }
}

// ═══════════════════════════════════════════════════════════════════
// Optimale Rate finden (3-stufig + Sensitivitätsanalyse)
// ═══════════════════════════════════════════════════════════════════

export function findOptimalRate(input: PdgFonInput): PdgFonResult | null {
  const { lat, lon, altitude, goalLat, goalLon, direction, minAltFt, maxAltFt, minDistM, windLayers } = input

  if (windLayers.length === 0) return null

  // Höhenfenster berechnen
  const startAltFt = altitude * 3.28084
  const minTargetFt = direction === 'up' ? startAltFt + minAltFt : startAltFt - minAltFt
  const minTargetAltM = minTargetFt * 0.3048

  let maxTargetAltM: number
  if (maxAltFt > 0) {
    const valid = direction === 'up' ? maxAltFt > minTargetFt : maxAltFt < minTargetFt
    maxTargetAltM = valid ? maxAltFt * 0.3048 : (direction === 'up' ? 10000 : 0)
  } else {
    maxTargetAltM = direction === 'up' ? 10000 : 0
  }

  // Hilfsfunktion: Rate simulieren
  const sim = (rate: number) => simulateFlight(
    lat, lon, altitude, rate, windLayers, goalLat, goalLon,
    minTargetAltM, maxTargetAltM, minDistM, direction, true, false
  )

  // Stufe 1: Grob (0.25 bis 5.0 in 0.5er Schritten)
  let bestRate = 0, bestDist = Infinity
  for (let r = 0.25; r <= 5.0; r += 0.5) {
    const rate = direction === 'up' ? r : -r
    const result = sim(rate)
    if (result && result.distToGoal < bestDist) { bestDist = result.distToGoal; bestRate = rate }
  }

  if (bestRate === 0) return null

  // Stufe 2: Fein (±0.5 in 0.05er Schritten)
  const base2 = Math.abs(bestRate)
  for (let r = Math.max(0.1, base2 - 0.5); r <= base2 + 0.5; r += 0.05) {
    const rate = direction === 'up' ? r : -r
    const result = sim(rate)
    if (result && result.distToGoal < bestDist) { bestDist = result.distToGoal; bestRate = rate }
  }

  // Stufe 3: Ultra-fein (±0.1 in 0.01er Schritten)
  const base3 = Math.abs(bestRate)
  for (let r = Math.max(0.05, base3 - 0.1); r <= base3 + 0.1; r += 0.01) {
    const rate = direction === 'up' ? r : -r
    const result = sim(rate)
    if (result && result.distToGoal < bestDist) { bestDist = result.distToGoal; bestRate = rate }
  }

  // Finale Simulation mit Pfad
  const finalResult = simulateFlight(
    lat, lon, altitude, bestRate, windLayers, goalLat, goalLon,
    minTargetAltM, maxTargetAltM, minDistM, direction, true, true
  )
  if (!finalResult) return null

  // Sensitivitätsanalyse: ±0.1 m/s
  let maxShift = 0
  for (const delta of [0.1, -0.1]) {
    const sensResult = sim(bestRate + delta)
    if (sensResult) {
      const shift = calculateDistance(sensResult.endLat, sensResult.endLon, finalResult.endLat, finalResult.endLon)
      maxShift = Math.max(maxShift, shift)
    }
  }

  // Score: Niedrige Rate (40%) + Niedrige Sensitivität (40%) + Kurze Flugzeit (20%)
  const rateScore = 1 - Math.min(Math.abs(bestRate), 5) / 5
  const sensScore = 1 - Math.min(maxShift, 500) / 500
  const timeScore = 1 - Math.min(finalResult.endTime, 1800) / 1800
  const score = rateScore * 0.4 + sensScore * 0.4 + timeScore * 0.2

  console.log(`[PdgFon] Rate: ${bestRate.toFixed(2)} m/s | Dist: ${Math.round(finalResult.distToGoal)}m | Sens: ±${Math.round(maxShift)}m | Alt: ${Math.round(finalResult.endAlt * 3.28084)}ft | Score: ${score.toFixed(2)}`)

  return {
    rate: bestRate,
    point: { lat: finalResult.endLat, lon: finalResult.endLon, altitude: finalResult.endAlt },
    distToGoal: Math.round(finalResult.distToGoal),
    altChange: Math.round(finalResult.endAlt - altitude),
    flightTime: finalResult.endTime,
    sensitivity: Math.round(maxShift),
    score,
    path: finalResult.path
  }
}

// ═══════════════════════════════════════════════════════════════════
// Live-Korrektur (leichtgewichtig, ab aktueller Position)
// ═══════════════════════════════════════════════════════════════════

export function calculateLiveCorrection(
  currentLat: number, currentLon: number, currentAlt: number,
  targetLat: number, targetLon: number, targetAlt: number,
  windLayers: WindLayer[]
): PdgFonCorrection {
  const distToGoal = calculateDistance(currentLat, currentLon, targetLat, targetLon)
  const altDiff = targetAlt - currentAlt
  const direction = altDiff > 0 ? 'up' : 'down'

  // Schnelle 2-stufige Suche (grob + fein)
  const sim = (rate: number): number => {
    let lat2 = currentLat, lon2 = currentLon, alt2 = currentAlt
    let best = Infinity
    for (let t = 1; t <= 1800; t++) {
      alt2 += rate
      if (alt2 < 0 || alt2 > 10000) break
      const wind = interpolateWind(alt2, windLayers)
      const newPos = calculateDestination(lat2, lon2, (wind.direction + 180) % 360, wind.speedMs)
      lat2 = newPos.lat; lon2 = newPos.lon
      const hDist = calculateDistance(lat2, lon2, targetLat, targetLon)
      const vDist = Math.abs(alt2 - targetAlt)
      const d = Math.sqrt(hDist * hDist + vDist * vDist)
      if (d < best) best = d
      else if (d > best * 2) break
    }
    return best
  }

  let bestRate = 0, bestDist = Infinity

  if (windLayers.length > 0 && distToGoal > 10) {
    // Grob
    for (let r = 0.25; r <= 5.0; r += 0.5) {
      const rate = direction === 'up' ? r : -r
      const d = sim(rate)
      if (d < bestDist) { bestDist = d; bestRate = rate }
    }
    // Fein
    const base = Math.abs(bestRate)
    for (let r = Math.max(0.1, base - 0.5); r <= base + 0.5; r += 0.05) {
      const rate = direction === 'up' ? r : -r
      const d = sim(rate)
      if (d < bestDist) { bestDist = d; bestRate = rate }
    }
  }

  // Predicted Miss: Wo lande ich mit Rate 0 (= nichts ändern)?
  const missWithZero = sim(0)

  // Zeit-Schätzung
  const absRate = Math.abs(bestRate)
  const timeRemaining = absRate > 0.1 ? Math.abs(altDiff) / absRate : 999

  return {
    rate: bestRate,
    distToGoal,
    predictedMiss: Math.round(bestDist),
    altDiff,
    timeRemaining: Math.round(timeRemaining)
  }
}

// ═══════════════════════════════════════════════════════════════════
// Korrektur-Höhen: Beste Links/Rechts Windschichten
// ═══════════════════════════════════════════════════════════════════

export interface CorrectionHeight {
  altFt: number
  angle: number  // Grad Abweichung vom Zielkurs (negativ=links, positiv=rechts)
}

export function findCorrectionHeights(
  pilotLat: number, pilotLon: number, pilotAlt: number,
  targetLat: number, targetLon: number, targetAlt: number,
  windLayers: WindLayer[]
): { left: CorrectionHeight[]; right: CorrectionHeight[] } {
  const bearingToGoal = calculateBearing(pilotLat, pilotLon, targetLat, targetLon)
  const minH = Math.min(pilotAlt, targetAlt)
  const maxH = Math.max(pilotAlt, targetAlt)

  const lefts: CorrectionHeight[] = []
  const rights: CorrectionHeight[] = []

  for (let h = minH; h <= maxH; h += 15) {
    const wind = interpolateWind(h, windLayers)
    if (wind.speedMs < 0.3) continue
    const driftDir = (wind.direction + 180) % 360

    let angleDiff = driftDir - bearingToGoal
    if (angleDiff > 180) angleDiff -= 360
    if (angleDiff < -180) angleDiff += 360

    const altFt = Math.round(h * 3.28084)
    if (angleDiff < -5) lefts.push({ altFt, angle: angleDiff })
    if (angleDiff > 5) rights.push({ altFt, angle: angleDiff })
  }

  lefts.sort((a, b) => a.angle - b.angle)
  rights.sort((a, b) => b.angle - a.angle)

  return {
    left: lefts.slice(0, 3),
    right: rights.slice(0, 3)
  }
}

/**
 * Berechnet die Soll-Rate für die aktuelle Phase (Ramp-Up).
 * @param elapsedSec - Sekunden seit Berechnung/Deklaration
 * @param fullRate - Die berechnete optimale Rate (absolut, positiv)
 * @param direction - 'up' oder 'down'
 * @returns Die Rate die der Pilot JETZT fliegen soll (mit Vorzeichen)
 */
export function getCurrentTargetRate(
  elapsedSec: number,
  fullRate: number,
  direction: 'up' | 'down'
): number {
  if (elapsedSec < LEAD_TIME) return 0  // Vorlauf: Noch nicht steigen/sinken
  const sinceStart = elapsedSec - LEAD_TIME
  const absRate = sinceStart < RAMP_UP ? fullRate * (sinceStart / RAMP_UP) : fullRate
  return direction === 'up' ? absRate : -absRate
}
