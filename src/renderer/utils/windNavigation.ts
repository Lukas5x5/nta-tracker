/**
 * Wind Navigation (WNV) — Beta
 *
 * Berechnet die optimale Flugstrategie um ein Ziel am Boden zu erreichen.
 *
 * Algorithmus:
 * 1. Für jede Windschicht-Höhe als Zielhöhe:
 *    a) Simuliere Steigen/Sinken (mit Drift während Höhenänderung)
 *    b) Auf Zielhöhe: Drift bis zum nächsten Punkt am Goal (CPA)
 *    c) Von CPA: Sinken zum Boden (mit Drift)
 *    d) Messe Distanz zum Goal
 * 2. Für die Top-5 Höhen: Fein-Optimierung der Rate (0.1er Schritte)
 * 3. Für 2-Leg: Top-Höhe aus Schritt 1 als Leg 1, dann alle Höhen als Leg 2
 */

import { calculateDistance, calculateDestination, calculateBearing, interpolateWind } from './navigation'

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface WindLayer {
  altitude: number  // Meter MSL
  direction: number // Grad (woher der Wind kommt)
  speed: number     // km/h
}

export interface WnvInput {
  pilotLat: number
  pilotLon: number
  pilotAltitude: number
  goalLat: number
  goalLon: number
  goalElevation: number
  windLayers: WindLayer[]
  maxLegs: 1 | 2
}

export interface WnvLeg {
  targetAltitude: number
  targetAltitudeFt: number
  action: 'STEIGEN' | 'SINKEN' | 'DRIFT'
  rate: number         // m/s
  rateFtMin: number
  durationSec: number
  windDirection: number
  windSpeedKmh: number
}

export interface WnvResult {
  legs: WnvLeg[]
  predictedPath: { lat: number; lon: number; altitude: number }[]
  landingPoint: { lat: number; lon: number }
  distanceToGoal: number
  totalTimeSec: number
  instruction: string
  instructionAltFt: number
  instructionAction: 'STEIGEN' | 'SINKEN' | 'HALTEN'
  recommendedRate: number
  recommendedRateFtMin: number
}

// ═══════════════════════════════════════════════════════════════════
// Hilfsfunktionen
// ═══════════════════════════════════════════════════════════════════

const toFt50 = (m: number) => Math.round(m * 3.28084 / 50) * 50
const PATH_SAMPLE = 5

function normalizeAngle(a: number): number {
  while (a > 180) a -= 360
  while (a < -180) a += 360
  return a
}

// ═══════════════════════════════════════════════════════════════════
// Kern-Simulation: Von A nach B fliegen und am Ende Distanz messen
// ═══════════════════════════════════════════════════════════════════

interface SimResult {
  lat: number; lon: number; alt: number
  distToGoal: number
  totalTime: number
  path: { lat: number; lon: number; altitude: number }[]
  legs: WnvLeg[]
}

// Simuliere: Steigen/Sinken auf targetAlt mit gegebener Rate, dann Drift bis CPA, dann Sinken zum Boden
function simulateOneLeg(
  startLat: number, startLon: number, startAlt: number,
  targetAlt: number, rate: number,
  goalLat: number, goalLon: number, goalElev: number,
  windLayers: WindLayer[]
): SimResult {
  let lat = startLat, lon = startLon, alt = startAlt
  let totalTime = 0
  const path: { lat: number; lon: number; altitude: number }[] = [{ lat, lon, altitude: alt }]
  const legs: WnvLeg[] = []

  // ── Phase 1: Steigen/Sinken zur Zielhöhe ──
  const altDiff = targetAlt - alt
  if (Math.abs(altDiff) > 3) {
    const dir = altDiff > 0 ? 1 : -1
    const legStart = totalTime
    const w0 = interpolateWind(alt, windLayers)

    while ((dir > 0 && alt < targetAlt) || (dir < 0 && alt > targetAlt)) {
      const w = interpolateWind(alt, windLayers)
      const drift = (w.direction + 180) % 360
      const dest = calculateDestination(lat, lon, drift, w.speedMs)
      lat = dest.lat; lon = dest.lon
      alt += dir * rate
      totalTime++
      if (totalTime % PATH_SAMPLE === 0) path.push({ lat, lon, altitude: alt })
      if (totalTime > 5400) break
    }
    alt = targetAlt

    legs.push({
      targetAltitude: targetAlt, targetAltitudeFt: toFt50(targetAlt),
      action: altDiff > 0 ? 'STEIGEN' : 'SINKEN',
      rate: Math.round(rate * 10) / 10, rateFtMin: Math.round(rate * 3.28084 * 60),
      durationSec: totalTime - legStart,
      windDirection: Math.round(w0.direction), windSpeedKmh: Math.round(w0.speedMs * 3.6)
    })
  }

  // ── Phase 2: Drift auf Zielhöhe bis CPA ──
  // Drift solange wir uns dem Goal nähern, stoppe sobald wir uns entfernen
  let minDist = calculateDistance(lat, lon, goalLat, goalLon)
  let bestLat = lat, bestLon = lon, bestTime = totalTime
  let staleCount = 0
  const driftStart = totalTime
  const dw = interpolateWind(alt, windLayers)

  for (let d = 0; d < 2400; d++) {  // Max 40 Min
    const w = interpolateWind(alt, windLayers)
    const drift = (w.direction + 180) % 360

    // Stoppe wenn Wind > 90° vom Goal weg zeigt und wir schon eine Weile driften
    if (d > 5) {
      const brg = calculateBearing(lat, lon, goalLat, goalLon)
      const off = Math.abs(normalizeAngle(drift - brg))
      if (off > 90) break
    }

    const dest = calculateDestination(lat, lon, drift, w.speedMs)
    lat = dest.lat; lon = dest.lon
    totalTime++
    if (totalTime % PATH_SAMPLE === 0) path.push({ lat, lon, altitude: alt })

    const dist = calculateDistance(lat, lon, goalLat, goalLon)
    if (dist < minDist) {
      minDist = dist; bestLat = lat; bestLon = lon; bestTime = totalTime
      staleCount = 0
    } else {
      staleCount++
      if (staleCount >= 15) break  // 15s ohne Verbesserung
    }
    if (totalTime > 5400) break
  }

  // Zurückspulen zum besten Punkt
  lat = bestLat; lon = bestLon
  const driftDuration = bestTime - driftStart
  totalTime = bestTime
  // Pfad kürzen bis zum besten Punkt
  while (path.length > 0 && path[path.length - 1].altitude === alt) {
    const lastP = path[path.length - 1]
    if (calculateDistance(lastP.lat, lastP.lon, goalLat, goalLon) > minDist + 5) {
      path.pop()
    } else break
  }

  if (driftDuration > 3) {
    legs.push({
      targetAltitude: alt, targetAltitudeFt: toFt50(alt), action: 'DRIFT',
      rate: 0, rateFtMin: 0, durationSec: driftDuration,
      windDirection: Math.round(dw.direction), windSpeedKmh: Math.round(dw.speedMs * 3.6)
    })
  }

  // ── Phase 3: Sinken zum Boden ──
  const sinkRate = 2.0  // Standard-Sinkrate
  if (alt > goalElev + 3) {
    const sinkStart = totalTime
    const sw = interpolateWind(alt, windLayers)

    while (alt > goalElev) {
      const w = interpolateWind(alt, windLayers)
      const drift = (w.direction + 180) % 360
      const dest = calculateDestination(lat, lon, drift, w.speedMs)
      lat = dest.lat; lon = dest.lon
      alt -= sinkRate
      if (alt < goalElev) alt = goalElev
      totalTime++
      if (totalTime % PATH_SAMPLE === 0) path.push({ lat, lon, altitude: alt })
      if (totalTime > 5400) break
    }

    legs.push({
      targetAltitude: goalElev, targetAltitudeFt: toFt50(goalElev), action: 'SINKEN',
      rate: sinkRate, rateFtMin: Math.round(sinkRate * 3.28084 * 60),
      durationSec: totalTime - sinkStart,
      windDirection: Math.round(sw.direction), windSpeedKmh: Math.round(sw.speedMs * 3.6)
    })
  }

  path.push({ lat, lon, altitude: alt })
  const distToGoal = Math.round(calculateDistance(lat, lon, goalLat, goalLon))

  return { lat, lon, alt, distToGoal, totalTime, path, legs }
}

// ═══════════════════════════════════════════════════════════════════
// Hauptberechnung
// ═══════════════════════════════════════════════════════════════════

export function calculateWindNav(input: WnvInput): WnvResult | null {
  const { pilotLat, pilotLon, pilotAltitude, goalLat, goalLon, goalElevation, windLayers, maxLegs } = input

  if (windLayers.length === 0) return null

  const allAlts = windLayers.map(l => l.altitude)
  const minAlt = Math.max(goalElevation + 20, Math.min(...allAlts))
  const maxAlt = Math.max(...allAlts)

  // Kandidaten-Höhen: Windschichten + Zwischenschritte
  const candidates: number[] = []
  for (const a of allAlts) {
    if (a >= minAlt && a <= maxAlt) candidates.push(a)
  }
  for (let a = Math.ceil(minAlt / 75) * 75; a <= maxAlt; a += 75) {
    candidates.push(a)
  }
  if (pilotAltitude >= minAlt && pilotAltitude <= maxAlt) candidates.push(pilotAltitude)
  const uniqueAlts = [...new Set(candidates.map(a => Math.round(a)))].sort((a, b) => a - b)
  if (uniqueAlts.length === 0) return null

  // Grobe Raten für ersten Durchlauf
  const coarseRates = [1.0, 2.0, 3.0, 4.0]

  let bestSim: SimResult | null = null
  let bestRate = 2.0
  let bestAlt = pilotAltitude

  // ── Pass 1: Grobe Suche — alle Höhen × grobe Raten ──
  for (const alt of uniqueAlts) {
    for (const rate of coarseRates) {
      const sim = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, alt, rate, goalLat, goalLon, goalElevation, windLayers)
      if (!bestSim || sim.distToGoal < bestSim.distToGoal) {
        bestSim = sim; bestRate = rate; bestAlt = alt
      }
    }
  }

  // ── Pass 2: Fein-Optimierung — Höhe ±50m, Rate ±0.5 in 0.2er Schritten ──
  if (bestSim) {
    const fineAlts: number[] = []
    for (let a = bestAlt - 75; a <= bestAlt + 75; a += 25) {
      if (a >= minAlt && a <= maxAlt) fineAlts.push(a)
    }
    const fineRates: number[] = []
    for (let r = Math.max(0.3, bestRate - 0.8); r <= Math.min(5, bestRate + 0.8); r += 0.2) {
      fineRates.push(Math.round(r * 10) / 10)
    }

    for (const alt of fineAlts) {
      for (const rate of fineRates) {
        const sim = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, alt, rate, goalLat, goalLon, goalElevation, windLayers)
        if (sim.distToGoal < bestSim.distToGoal) {
          bestSim = sim; bestRate = rate; bestAlt = alt
        }
      }
    }
  }

  // ── Pass 3: 2-Leg Strategien ──
  if (maxLegs >= 2 && bestSim && uniqueAlts.length >= 2) {
    // Nimm die beste 1-Leg Höhe als Leg 1, dann probiere alle Höhen als Leg 2
    const leg1Alt = bestAlt
    const leg1Rate = bestRate

    for (const leg2Alt of uniqueAlts) {
      if (leg2Alt === leg1Alt) continue
      // Simuliere Leg 1
      const sim1 = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, leg1Alt, leg1Rate, goalLat, goalLon, goalElevation, windLayers)
      // Nach Leg 1 Drift: Von dort weiter zu Leg 2
      // Finde den Punkt nach dem Steigen (vor dem Drift) als Start für Leg 2
      const afterClimb = sim1.legs[0]
      if (!afterClimb) continue

      // Simuliere von der Drift-Position nach Leg 2
      const driftLeg = sim1.legs.find(l => l.action === 'DRIFT')
      const leg1EndLat = driftLeg ? sim1.lat : sim1.lat  // Nach dem gesamten Leg 1
      const leg1EndLon = driftLeg ? sim1.lon : sim1.lon
      const leg1EndAlt = leg1Alt

      for (const rate2 of [1.0, 2.0, 3.0]) {
        const sim2 = simulateOneLeg(leg1EndLat, leg1EndLon, leg1EndAlt, leg2Alt, rate2, goalLat, goalLon, goalElevation, windLayers)
        if (sim2.distToGoal < bestSim.distToGoal) {
          // Kombiniere Legs
          const combinedLegs = [...sim1.legs.filter(l => l.action !== 'SINKEN'), ...sim2.legs]
          const combinedPath = [...sim1.path.slice(0, -1), ...sim2.path]
          bestSim = {
            lat: sim2.lat, lon: sim2.lon, alt: sim2.alt,
            distToGoal: sim2.distToGoal,
            totalTime: sim1.totalTime + sim2.totalTime,
            path: combinedPath,
            legs: combinedLegs
          }
          bestRate = leg1Rate
          bestAlt = leg1Alt
        }
      }
    }
  }

  if (!bestSim) return null

  // Anweisung
  const firstLeg = bestSim.legs[0]
  let instruction = 'HALTEN'
  let instructionAltFt = toFt50(pilotAltitude)
  let instructionAction: 'STEIGEN' | 'SINKEN' | 'HALTEN' = 'HALTEN'
  let recommendedRate = 0, recommendedRateFtMin = 0

  if (firstLeg && firstLeg.action !== 'DRIFT') {
    instructionAltFt = firstLeg.targetAltitudeFt
    instructionAction = firstLeg.action
    instruction = `${firstLeg.action} auf ${instructionAltFt} ft`
    recommendedRate = firstLeg.rate
    recommendedRateFtMin = firstLeg.rateFtMin
  } else if (firstLeg) {
    instruction = `DRIFT auf ${firstLeg.targetAltitudeFt} ft`
  }

  return {
    legs: bestSim.legs,
    predictedPath: bestSim.path,
    landingPoint: { lat: bestSim.lat, lon: bestSim.lon },
    distanceToGoal: bestSim.distToGoal,
    totalTimeSec: bestSim.totalTime,
    instruction, instructionAltFt, instructionAction,
    recommendedRate, recommendedRateFtMin
  }
}
