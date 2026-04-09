/**
 * Wind Navigation (WNV)
 *
 * Berechnet die optimale Flugstrategie um ein Ziel am Boden zu erreichen.
 * Unterstützt 1-3 Legs, Sensitivity-Analyse und Live-Guidance.
 *
 * Algorithmus:
 * 1. Für jede Windschicht-Höhe als Zielhöhe:
 *    a) Simuliere Steigen/Sinken (mit Drift während Höhenänderung)
 *    b) Auf Zielhöhe: Drift bis zum nächsten Punkt am Goal (CPA)
 *    c) Von CPA: Sinken zum Boden (mit Drift)
 *    d) Messe Distanz zum Goal
 * 2. Fein-Optimierung der Rate für die Top-Kandidaten
 * 3. Multi-Leg: Top-Höhen kombinieren (2-Leg: Top10×alle, 3-Leg: Top5-2Leg×alle)
 * 4. Sensitivity-Analyse: Rate ±0.5 m/s testen
 * 5. Live-Guidance: Leichtgewichtige Nachverfolgung im Flug
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
  maxLegs: 1 | 2 | 3
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
  // Neue Felder
  sensitivity: number        // Meter-Shift bei ±0.5 m/s
  score: number              // Composite Score (niedriger = besser)
  altitudeSequence: number[] // Fingerprint: Zielhöhen der Legs in Reihenfolge
}

export interface WnvGuidance {
  action: 'STEIGEN' | 'SINKEN' | 'HALTEN'
  targetAltFt: number
  recommendedRate: number
  recommendedRateFtMin: number
  currentLegIndex: number
  totalLegs: number
  legPhase: 'climb' | 'drift' | 'descend'
  legProgress: number          // 0.0 - 1.0
  crossTrackErrorM: number     // CDI: Abstand vom geplanten Pfad
  deviationLevel: 'on-track' | 'minor' | 'major'
  bearingToGoal: number
  currentDriftBearing: number
  distToGoal: number
  livePath: { lat: number; lon: number; altitude: number }[]
  liveDistToGoal: number
  shouldRecalc: boolean
  recalcReason: string | null
}

// ═══════════════════════════════════════════════════════════════════
// Hilfsfunktionen
// ═══════════════════════════════════════════════════════════════════

const toFt50 = (m: number) => Math.round(m * 3.28084 / 50) * 50
const PATH_SAMPLE = 5
const MAX_SIM_TIME = 5400  // 90 min
const MAX_DRIFT_PER_LEG = 600  // 10 min Drift pro Leg

function normalizeAngle(a: number): number {
  while (a > 180) a -= 360
  while (a < -180) a += 360
  return a
}

// ═══════════════════════════════════════════════════════════════════
// Kern-Simulation: Einen Leg fliegen
// ═══════════════════════════════════════════════════════════════════

interface SimResult {
  lat: number; lon: number; alt: number
  distToGoal: number
  totalTime: number
  path: { lat: number; lon: number; altitude: number }[]
  legs: WnvLeg[]
}

/**
 * Simuliere: Steigen/Sinken auf targetAlt, dann Drift bis CPA, dann Sinken zum Boden.
 * collectPath=false für Performance bei Brute-Force-Suche.
 */
function simulateOneLeg(
  startLat: number, startLon: number, startAlt: number,
  targetAlt: number, rate: number,
  goalLat: number, goalLon: number, goalElev: number,
  windLayers: WindLayer[],
  collectPath = true
): SimResult {
  let lat = startLat, lon = startLon, alt = startAlt
  let totalTime = 0
  const path: { lat: number; lon: number; altitude: number }[] = collectPath ? [{ lat, lon, altitude: alt }] : []
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
      if (collectPath && totalTime % PATH_SAMPLE === 0) path.push({ lat, lon, altitude: alt })
      if (totalTime > MAX_SIM_TIME) break
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
  let minDist = calculateDistance(lat, lon, goalLat, goalLon)
  let bestLat = lat, bestLon = lon, bestTime = totalTime
  let staleCount = 0
  const driftStart = totalTime
  const dw = interpolateWind(alt, windLayers)

  for (let d = 0; d < MAX_DRIFT_PER_LEG; d++) {
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
    if (collectPath && totalTime % PATH_SAMPLE === 0) path.push({ lat, lon, altitude: alt })

    const dist = calculateDistance(lat, lon, goalLat, goalLon)
    if (dist < minDist) {
      minDist = dist; bestLat = lat; bestLon = lon; bestTime = totalTime
      staleCount = 0
    } else {
      staleCount++
      if (staleCount >= 15) break
    }
    if (totalTime > MAX_SIM_TIME) break
  }

  // Zurückspulen zum besten Punkt
  lat = bestLat; lon = bestLon
  const driftDuration = bestTime - driftStart
  totalTime = bestTime

  // Pfad kürzen bis zum besten Punkt
  if (collectPath) {
    while (path.length > 0 && path[path.length - 1].altitude === alt) {
      const lastP = path[path.length - 1]
      if (calculateDistance(lastP.lat, lastP.lon, goalLat, goalLon) > minDist + 5) {
        path.pop()
      } else break
    }
  }

  if (driftDuration > 3) {
    legs.push({
      targetAltitude: alt, targetAltitudeFt: toFt50(alt), action: 'DRIFT',
      rate: 0, rateFtMin: 0, durationSec: driftDuration,
      windDirection: Math.round(dw.direction), windSpeedKmh: Math.round(dw.speedMs * 3.6)
    })
  }

  // ── Phase 3: Sinken zum Boden ──
  const sinkRate = 2.0
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
      if (collectPath && totalTime % PATH_SAMPLE === 0) path.push({ lat, lon, altitude: alt })
      if (totalTime > MAX_SIM_TIME) break
    }

    legs.push({
      targetAltitude: goalElev, targetAltitudeFt: toFt50(goalElev), action: 'SINKEN',
      rate: sinkRate, rateFtMin: Math.round(sinkRate * 3.28084 * 60),
      durationSec: totalTime - sinkStart,
      windDirection: Math.round(sw.direction), windSpeedKmh: Math.round(sw.speedMs * 3.6)
    })
  }

  if (collectPath) path.push({ lat, lon, altitude: alt })
  const distToGoal = Math.round(calculateDistance(lat, lon, goalLat, goalLon))

  return { lat, lon, alt, distToGoal, totalTime, path, legs }
}

/**
 * Simuliere einen Leg OHNE Sinken zum Boden — für Multi-Leg Zwischenschritte.
 * Gibt Position/Höhe nach Climb+Drift zurück.
 */
function simulateLegNoDescend(
  startLat: number, startLon: number, startAlt: number,
  targetAlt: number, rate: number,
  goalLat: number, goalLon: number,
  windLayers: WindLayer[]
): { lat: number; lon: number; alt: number; totalTime: number; legs: WnvLeg[]; path: { lat: number; lon: number; altitude: number }[] } {
  let lat = startLat, lon = startLon, alt = startAlt
  let totalTime = 0
  const path: { lat: number; lon: number; altitude: number }[] = [{ lat, lon, altitude: alt }]
  const legs: WnvLeg[] = []

  // Phase 1: Steigen/Sinken
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
      if (totalTime > MAX_SIM_TIME) break
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

  // Phase 2: Drift bis CPA
  let minDist = calculateDistance(lat, lon, goalLat, goalLon)
  let bestLat = lat, bestLon = lon, bestTime = totalTime
  let staleCount = 0
  const driftStart = totalTime
  const dw = interpolateWind(alt, windLayers)

  for (let d = 0; d < MAX_DRIFT_PER_LEG; d++) {
    const w = interpolateWind(alt, windLayers)
    const drift = (w.direction + 180) % 360
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
      if (staleCount >= 15) break
    }
    if (totalTime > MAX_SIM_TIME) break
  }

  lat = bestLat; lon = bestLon; totalTime = bestTime
  const driftDuration = bestTime - driftStart

  if (driftDuration > 3) {
    legs.push({
      targetAltitude: alt, targetAltitudeFt: toFt50(alt), action: 'DRIFT',
      rate: 0, rateFtMin: 0, durationSec: driftDuration,
      windDirection: Math.round(dw.direction), windSpeedKmh: Math.round(dw.speedMs * 3.6)
    })
  }

  path.push({ lat, lon, altitude: alt })
  return { lat, lon, alt, totalTime, legs, path }
}

// ═══════════════════════════════════════════════════════════════════
// Effective Score: Distanz + Zeitstrafe
// ═══════════════════════════════════════════════════════════════════

function effectiveScore(distToGoal: number, totalTime: number): number {
  // 5 Meter Strafe pro Sekunde Flugzeit (bei ähnlicher Distanz schnellere Strategie bevorzugen)
  return distToGoal + totalTime * 0.05
}

// ═══════════════════════════════════════════════════════════════════
// Sensitivity-Analyse
// ═══════════════════════════════════════════════════════════════════

function analyzeSensitivity(
  input: WnvInput,
  bestSim: SimResult,
  bestAlt: number,
  bestRate: number
): { sensitivity: number; score: number } {
  const { pilotLat, pilotLon, pilotAltitude, goalLat, goalLon, goalElevation, windLayers } = input

  // Rate ±0.5 m/s testen
  let maxShift = 0
  for (const delta of [-0.5, -0.3, 0.3, 0.5]) {
    const testRate = Math.max(0.3, bestRate + delta)
    const sim = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, bestAlt, testRate, goalLat, goalLon, goalElevation, windLayers, false)
    const shift = Math.abs(sim.distToGoal - bestSim.distToGoal)
    if (shift > maxShift) maxShift = shift
  }

  // Score berechnen: distance(20%) + rate(30%) + sensitivity(30%) + time(20%)
  // Normierung: 0-1 Skala, niedriger = besser
  const distNorm = Math.min(bestSim.distToGoal / 2000, 1)   // 2km = max
  const rateNorm = Math.min(bestRate / 5, 1)                  // 5 m/s = max
  const sensNorm = Math.min(maxShift / 1000, 1)               // 1km Shift = max
  const timeNorm = Math.min(bestSim.totalTime / 3600, 1)      // 1h = max

  const score = distNorm * 0.2 + rateNorm * 0.3 + sensNorm * 0.3 + timeNorm * 0.2

  return { sensitivity: Math.round(maxShift), score: Math.round(score * 100) / 100 }
}

// ═══════════════════════════════════════════════════════════════════
// Hauptberechnung
// ═══════════════════════════════════════════════════════════════════

export function calculateWindNav(input: WnvInput, continuityBias?: number[]): WnvResult | null {
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

  const coarseRates = [1.0, 2.0, 3.0, 4.0]

  // ── Pass 1: Grobe Suche — alle Höhen × grobe Raten ──
  interface Candidate { sim: SimResult; rate: number; alt: number; score: number }
  const pass1Results: Candidate[] = []

  for (const alt of uniqueAlts) {
    for (const rate of coarseRates) {
      const sim = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, alt, rate, goalLat, goalLon, goalElevation, windLayers, false)
      let score = effectiveScore(sim.distToGoal, sim.totalTime)
      // Continuity-Bias: 30% Bonus wenn Höhe im vorgegebenen Sequence ist
      if (continuityBias && continuityBias.length > 0 && Math.abs(alt - continuityBias[0]) < 50) {
        score *= 0.7
      }
      pass1Results.push({ sim, rate, alt, score })
    }
  }

  pass1Results.sort((a, b) => a.score - b.score)

  let bestSim = pass1Results[0]?.sim || null
  let bestRate = pass1Results[0]?.rate || 2.0
  let bestAlt = pass1Results[0]?.alt || pilotAltitude
  let bestScore = pass1Results[0]?.score || Infinity

  if (!bestSim) return null

  // ── Pass 2: Fein-Optimierung — Top-5 Höhen, Rate ±0.8 in 0.2er Schritten ──
  const top5 = pass1Results.slice(0, 5)
  for (const cand of top5) {
    const fineAlts: number[] = []
    for (let a = cand.alt - 75; a <= cand.alt + 75; a += 25) {
      if (a >= minAlt && a <= maxAlt) fineAlts.push(a)
    }
    const fineRates: number[] = []
    for (let r = Math.max(0.3, cand.rate - 0.8); r <= Math.min(5, cand.rate + 0.8); r += 0.2) {
      fineRates.push(Math.round(r * 10) / 10)
    }

    for (const alt of fineAlts) {
      for (const rate of fineRates) {
        const sim = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, alt, rate, goalLat, goalLon, goalElevation, windLayers, false)
        let score = effectiveScore(sim.distToGoal, sim.totalTime)
        if (continuityBias && continuityBias.length > 0 && Math.abs(alt - continuityBias[0]) < 50) {
          score *= 0.7
        }
        if (score < bestScore) {
          bestSim = sim; bestRate = rate; bestAlt = alt; bestScore = score
        }
      }
    }
  }

  // ── Pass 3: 2-Leg Strategien (Top-10 als Leg 1) ──
  interface MultiLegCandidate {
    sim: SimResult
    leg1Alt: number; leg1Rate: number
    leg2Alt: number; leg2Rate: number
    score: number
    endLat: number; endLon: number; endAlt: number
    totalTime: number
    combinedLegs: WnvLeg[]
    combinedPath: { lat: number; lon: number; altitude: number }[]
  }

  const twoLegCandidates: MultiLegCandidate[] = []

  if (maxLegs >= 2 && uniqueAlts.length >= 2) {
    const top10 = pass1Results.slice(0, 10)

    for (const leg1Cand of top10) {
      // Leg 1 ohne Sinken zum Boden
      const leg1 = simulateLegNoDescend(
        pilotLat, pilotLon, pilotAltitude,
        leg1Cand.alt, leg1Cand.rate,
        goalLat, goalLon, windLayers
      )

      for (const leg2Alt of uniqueAlts) {
        if (leg2Alt === leg1Cand.alt) continue
        for (const rate2 of [1.5, 2.5, 3.5]) {
          const sim2 = simulateOneLeg(
            leg1.lat, leg1.lon, leg1.alt,
            leg2Alt, rate2,
            goalLat, goalLon, goalElevation, windLayers, false
          )
          const totalTime = leg1.totalTime + sim2.totalTime
          let score = effectiveScore(sim2.distToGoal, totalTime)
          // Continuity-Bias für 2-Leg
          if (continuityBias && continuityBias.length >= 2) {
            if (Math.abs(leg1Cand.alt - continuityBias[0]) < 50 && Math.abs(leg2Alt - continuityBias[1]) < 50) {
              score *= 0.7
            }
          }

          if (score < bestScore) {
            const combinedLegs = [...leg1.legs, ...sim2.legs]
            const combinedPath = [...leg1.path.slice(0, -1), ...sim2.path]
            bestSim = {
              lat: sim2.lat, lon: sim2.lon, alt: sim2.alt,
              distToGoal: sim2.distToGoal,
              totalTime,
              path: combinedPath,
              legs: combinedLegs
            }
            bestRate = leg1Cand.rate
            bestAlt = leg1Cand.alt
            bestScore = score
          }

          twoLegCandidates.push({
            sim: sim2,
            leg1Alt: leg1Cand.alt, leg1Rate: leg1Cand.rate,
            leg2Alt, leg2Rate: rate2, score,
            endLat: sim2.lat, endLon: sim2.lon, endAlt: leg2Alt,
            totalTime,
            combinedLegs: [...leg1.legs, ...sim2.legs],
            combinedPath: [...leg1.path.slice(0, -1), ...sim2.path]
          })
        }
      }
    }

    twoLegCandidates.sort((a, b) => a.score - b.score)
  }

  // ── Pass 4: 3-Leg Strategien (Top-5 der 2-Leg als Basis) ──
  if (maxLegs >= 3 && twoLegCandidates.length >= 1 && uniqueAlts.length >= 3) {
    const top5TwoLeg = twoLegCandidates.slice(0, 5)

    for (const base of top5TwoLeg) {
      // Von Leg-2 Endpunkt: Leg 3 ohne nochmal zum Boden zu sinken (simulateOneLeg macht das schon)
      const leg2End = simulateLegNoDescend(
        pilotLat, pilotLon, pilotAltitude,
        base.leg1Alt, base.leg1Rate,
        goalLat, goalLon, windLayers
      )
      const leg2Mid = simulateLegNoDescend(
        leg2End.lat, leg2End.lon, leg2End.alt,
        base.leg2Alt, base.leg2Rate,
        goalLat, goalLon, windLayers
      )

      for (const leg3Alt of uniqueAlts) {
        if (leg3Alt === base.leg2Alt) continue
        for (const rate3 of [1.5, 2.5, 3.5]) {
          const sim3 = simulateOneLeg(
            leg2Mid.lat, leg2Mid.lon, leg2Mid.alt,
            leg3Alt, rate3,
            goalLat, goalLon, goalElevation, windLayers, false
          )
          const totalTime = leg2End.totalTime + leg2Mid.totalTime + sim3.totalTime
          let score = effectiveScore(sim3.distToGoal, totalTime)

          if (continuityBias && continuityBias.length >= 3) {
            if (Math.abs(base.leg1Alt - continuityBias[0]) < 50 &&
                Math.abs(base.leg2Alt - continuityBias[1]) < 50 &&
                Math.abs(leg3Alt - continuityBias[2]) < 50) {
              score *= 0.7
            }
          }

          if (score < bestScore) {
            const combinedLegs = [...leg2End.legs, ...leg2Mid.legs, ...sim3.legs]
            const combinedPath = [...leg2End.path.slice(0, -1), ...leg2Mid.path.slice(0, -1), ...sim3.path]
            bestSim = {
              lat: sim3.lat, lon: sim3.lon, alt: sim3.alt,
              distToGoal: sim3.distToGoal,
              totalTime,
              path: combinedPath,
              legs: combinedLegs
            }
            bestRate = base.leg1Rate
            bestAlt = base.leg1Alt
            bestScore = score
          }
        }
      }
    }
  }

  if (!bestSim) return null

  // Finalen Pfad sammeln wenn noch nicht vorhanden (war collectPath=false bei Brute-Force)
  if (bestSim.path.length === 0) {
    // Nochmal mit collectPath=true simulieren für den Gewinner
    const finalSim = simulateOneLeg(pilotLat, pilotLon, pilotAltitude, bestAlt, bestRate, goalLat, goalLon, goalElevation, windLayers, true)
    bestSim = { ...bestSim, path: finalSim.path }
  }

  // Sensitivity-Analyse
  const { sensitivity, score } = analyzeSensitivity(input, bestSim, bestAlt, bestRate)

  // Altitude-Sequence extrahieren (nur Climb/Sink Legs, nicht Drift/Boden-Sink)
  const altitudeSequence = bestSim.legs
    .filter(l => l.action === 'STEIGEN' || (l.action === 'SINKEN' && l.targetAltitude > goalElevation + 50))
    .map(l => l.targetAltitude)

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
    recommendedRate, recommendedRateFtMin,
    sensitivity, score, altitudeSequence
  }
}

// ═══════════════════════════════════════════════════════════════════
// Neuberechnung mit Continuity-Bias
// ═══════════════════════════════════════════════════════════════════

export function recalculateWnvFromCurrent(
  input: WnvInput,
  currentAltitudeSequence: number[]
): WnvResult | null {
  return calculateWindNav(input, currentAltitudeSequence)
}

// ═══════════════════════════════════════════════════════════════════
// Live-Guidance: Leichtgewichtige Nachverfolgung im Flug
// ═══════════════════════════════════════════════════════════════════

/**
 * Findet den nächsten Punkt auf dem Pfad und gibt Index + Abstand zurück.
 */
function findClosestPathPoint(
  lat: number, lon: number,
  path: { lat: number; lon: number; altitude: number }[]
): { index: number; distance: number } {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < path.length; i++) {
    const d = calculateDistance(lat, lon, path[i].lat, path[i].lon)
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  return { index: bestIdx, distance: bestDist }
}

/**
 * Bestimmt welches Leg und welche Phase der Pilot gerade fliegt.
 */
function determineLegAndPhase(
  currentAlt: number,
  altitudeSequence: number[],
  legs: WnvLeg[],
  startAlt: number
): { legIndex: number; phase: 'climb' | 'drift' | 'descend'; progress: number } {
  // Finde das aktuelle Leg anhand der Höhe
  const climbSinkLegs = legs.filter(l => l.action === 'STEIGEN' || l.action === 'SINKEN')

  // Wenn nur ein Climb/Sink-Leg: prüfe ob wir noch steigen/sinken oder schon driften
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (leg.action === 'DRIFT') {
      // Sind wir nahe an der Drift-Höhe?
      if (Math.abs(currentAlt - leg.targetAltitude) < 30) {
        return { legIndex: i, phase: 'drift', progress: 0.5 }
      }
    } else if (leg.action === 'STEIGEN') {
      // Bestimme Start-Höhe dieses Legs
      const prevAlt = i === 0 ? startAlt : (legs[i - 1]?.targetAltitude ?? startAlt)
      if (currentAlt >= prevAlt - 10 && currentAlt <= leg.targetAltitude + 10) {
        const total = leg.targetAltitude - prevAlt
        const done = currentAlt - prevAlt
        const progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : 1
        return { legIndex: i, phase: 'climb', progress }
      }
    } else if (leg.action === 'SINKEN') {
      const prevAlt = i === 0 ? startAlt : (legs[i - 1]?.targetAltitude ?? startAlt)
      if (currentAlt <= prevAlt + 10 && currentAlt >= leg.targetAltitude - 10) {
        const total = prevAlt - leg.targetAltitude
        const done = prevAlt - currentAlt
        const progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : 1
        return { legIndex: i, phase: 'descend', progress }
      }
    }
  }

  // Fallback: Letztes Leg
  return { legIndex: Math.max(0, legs.length - 1), phase: 'descend', progress: 0.5 }
}

export function calculateWnvGuidance(
  currentLat: number, currentLon: number, currentAlt: number,
  declaredResult: WnvResult,
  goalLat: number, goalLon: number, goalElevation: number,
  windLayers: WindLayer[],
  declaredAlt: number
): WnvGuidance {
  const { legs, predictedPath, altitudeSequence, distanceToGoal: declaredDist } = declaredResult

  // Welches Leg und Phase
  const { legIndex, phase, progress } = determineLegAndPhase(currentAlt, altitudeSequence, legs, declaredAlt)
  const currentLeg = legs[legIndex]

  // Cross-Track-Error: Nächster Punkt auf dem geplanten Pfad
  const closest = findClosestPathPoint(currentLat, currentLon, predictedPath)
  const crossTrackErrorM = Math.round(closest.distance)

  // Deviation Level
  const deviationLevel: WnvGuidance['deviationLevel'] =
    crossTrackErrorM < 50 ? 'on-track' :
    crossTrackErrorM < 200 ? 'minor' : 'major'

  // Bearing und Drift
  const bearingToGoal = Math.round(calculateBearing(currentLat, currentLon, goalLat, goalLon))
  const currentWind = interpolateWind(currentAlt, windLayers)
  const currentDriftBearing = Math.round((currentWind.direction + 180) % 360)

  // Distanz zum Ziel
  const distToGoal = Math.round(calculateDistance(currentLat, currentLon, goalLat, goalLon))

  // Aktuelle Anweisung
  let action: WnvGuidance['action'] = 'HALTEN'
  let targetAltFt = toFt50(currentAlt)
  let recommendedRate = 0
  let recommendedRateFtMin = 0

  if (currentLeg) {
    if (currentLeg.action === 'STEIGEN') {
      action = 'STEIGEN'
      targetAltFt = currentLeg.targetAltitudeFt
      recommendedRate = currentLeg.rate
      recommendedRateFtMin = currentLeg.rateFtMin
    } else if (currentLeg.action === 'SINKEN') {
      action = 'SINKEN'
      targetAltFt = currentLeg.targetAltitudeFt
      recommendedRate = currentLeg.rate
      recommendedRateFtMin = currentLeg.rateFtMin
    } else {
      // DRIFT — halte aktuelle Höhe
      action = 'HALTEN'
      targetAltFt = currentLeg.targetAltitudeFt
    }
  }

  // Live-Pfad: Quick-Forward-Simulation ab aktueller Position
  // Simuliere restliche Legs ab jetziger Position
  const remainingLegs = legs.slice(legIndex)
  let liveLat = currentLat, liveLon = currentLon, liveAlt = currentAlt
  const livePath: { lat: number; lon: number; altitude: number }[] = [{ lat: liveLat, lon: liveLon, altitude: liveAlt }]

  for (const leg of remainingLegs) {
    if (leg.action === 'STEIGEN' || leg.action === 'SINKEN') {
      const dir = leg.action === 'STEIGEN' ? 1 : -1
      const target = leg.targetAltitude
      let steps = 0
      while ((dir > 0 && liveAlt < target) || (dir < 0 && liveAlt > target)) {
        const w = interpolateWind(liveAlt, windLayers)
        const drift = (w.direction + 180) % 360
        const dest = calculateDestination(liveLat, liveLon, drift, w.speedMs)
        liveLat = dest.lat; liveLon = dest.lon
        liveAlt += dir * leg.rate
        steps++
        if (steps % PATH_SAMPLE === 0) livePath.push({ lat: liveLat, lon: liveLon, altitude: liveAlt })
        if (steps > 1800) break
      }
      liveAlt = target
    } else if (leg.action === 'DRIFT') {
      // Drift für die angegebene Dauer
      for (let d = 0; d < Math.min(leg.durationSec, MAX_DRIFT_PER_LEG); d++) {
        const w = interpolateWind(liveAlt, windLayers)
        const drift = (w.direction + 180) % 360
        const dest = calculateDestination(liveLat, liveLon, drift, w.speedMs)
        liveLat = dest.lat; liveLon = dest.lon
        if (d % PATH_SAMPLE === 0) livePath.push({ lat: liveLat, lon: liveLon, altitude: liveAlt })
      }
    }
  }
  livePath.push({ lat: liveLat, lon: liveLon, altitude: liveAlt })

  const liveDistToGoal = Math.round(calculateDistance(liveLat, liveLon, goalLat, goalLon))

  // Recalc-Empfehlung
  let shouldRecalc = false
  let recalcReason: string | null = null

  if (crossTrackErrorM > 300) {
    shouldRecalc = true
    recalcReason = `${crossTrackErrorM}m vom geplanten Pfad entfernt`
  } else if (liveDistToGoal > declaredDist * 2 && declaredDist > 50) {
    shouldRecalc = true
    recalcReason = `Voraussichtliche Distanz ${liveDistToGoal}m (${Math.round(liveDistToGoal / declaredDist)}× schlechter)`
  }

  return {
    action, targetAltFt, recommendedRate, recommendedRateFtMin,
    currentLegIndex: legIndex, totalLegs: legs.length,
    legPhase: phase, legProgress: progress,
    crossTrackErrorM, deviationLevel,
    bearingToGoal, currentDriftBearing,
    distToGoal,
    livePath, liveDistToGoal,
    shouldRecalc, recalcReason
  }
}
