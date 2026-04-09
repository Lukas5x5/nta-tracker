/**
 * Donut Calculator
 *
 * Berechnet die optimale Donut-Platzierung und Flugstrategie,
 * um die größtmögliche Strecke innerhalb des Rings zurückzulegen.
 *
 * Kern-Idee: Zickzack-Pendel zwischen zwei Windschichten.
 * Der Ballon pendelt zwischen Höhe A und Höhe B — wenn er droht den Ring
 * zu verlassen, wechselt er auf die andere Höhe die ihn zurücktreibt.
 * So kann er theoretisch beliebig lang im Ring bleiben.
 *
 * Algorithmus:
 * 1. 360° Scan: Teste 36 Richtungen × 3 Abstände für Donut-Mittelpunkt
 * 2. Für jeden Mittelpunkt: Finde bestes Höhen-Paar (altA, altB) zum Pendeln
 * 3. Simuliere Zickzack: Drift auf altA → nähert sich Rand → wechsle zu altB → repeat
 * 4. Höhen-Paar mit längster Strecke im Ring gewinnt
 */

import { calculateDistance, calculateDestination, calculateBearing, interpolateWind } from './navigation'

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface WindLayer {
  altitude: number
  direction: number
  speed: number
}

export interface DonutInput {
  pilotLat: number
  pilotLon: number
  pilotAltitude: number
  innerRadius: number    // Meter
  outerRadius: number    // Meter
  minCenterDist: number  // Meter — Mindestabstand Pilot → Donut-Mittelpunkt
  groundElevation: number
  windLayers: WindLayer[]
}

export interface DonutLeg {
  targetAltitude: number
  targetAltitudeFt: number
  action: 'STEIGEN' | 'SINKEN' | 'DRIFT'
  rate: number
  rateFtMin: number
  durationSec: number
  windDirection: number
  windSpeedKmh: number
  trackInRing: number  // Strecke im Ring während dieses Legs
}

export interface DonutResult {
  // Optimaler Donut-Platz
  centerLat: number
  centerLon: number
  centerBearing: number
  centerDistance: number

  // Strecken-Ergebnis
  trackInRing: number        // Gesamte Pfadlänge im Ring (Meter)
  totalTimeSec: number
  entryPoint: { lat: number; lon: number } | null
  exitPoint: { lat: number; lon: number } | null

  // Zickzack-Info
  zigzagCount: number        // Anzahl Höhenwechsel
  altA: number               // Pendel-Höhe A (Meter)
  altB: number               // Pendel-Höhe B (Meter)

  // Flugplan
  legs: DonutLeg[]
  predictedPath: { lat: number; lon: number; altitude: number }[]

  // Ring-Abschnitte im Pfad (für Karten-Highlighting)
  ringSegments: { lat: number; lon: number }[][]

  // Anweisung
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
const MAX_SIM_TIME = 5400  // 90 min
const RATE = 2.0           // Standard Steig-/Sinkrate m/s

function distToCenter(lat: number, lon: number, centerLat: number, centerLon: number): number {
  return calculateDistance(lat, lon, centerLat, centerLon)
}

function isInRing(dist: number, innerR: number, outerR: number): boolean {
  return dist >= innerR && dist <= outerR
}

// ═══════════════════════════════════════════════════════════════════
// Zickzack-Simulation: Pendeln zwischen zwei Höhen im Ring
// ═══════════════════════════════════════════════════════════════════

interface ZigzagResult {
  trackInRing: number
  totalTime: number
  zigzagCount: number
  path: { lat: number; lon: number; altitude: number }[]
  legs: DonutLeg[]
  entryPoint: { lat: number; lon: number } | null
  exitPoint: { lat: number; lon: number } | null
  ringSegments: { lat: number; lon: number }[][]
}

/**
 * Simuliert einen Zickzack-Flug zwischen altA und altB.
 *
 * Logik:
 * 1. Steige/Sinke auf altA, drifte
 * 2. Wenn Abstand zum Donut-Rand kritisch wird (nähert sich outerR oder innerR),
 *    wechsle auf altB
 * 3. Drifte auf altB, wenn wieder kritisch → zurück auf altA
 * 4. Repeat bis Zeitlimit oder endgültig aus dem Ring
 *
 * "Kritisch" = Abstand zum nächsten Rand < Puffer ODER Wind treibt aus dem Ring
 */
function simulateZigzag(
  startLat: number, startLon: number, startAlt: number,
  altA: number, altB: number, rate: number,
  centerLat: number, centerLon: number,
  innerR: number, outerR: number,
  groundElev: number,
  windLayers: WindLayer[],
  collectPath: boolean
): ZigzagResult {
  let lat = startLat, lon = startLon, alt = startAlt
  let totalTime = 0
  let trackInRing = 0
  let prevLat = lat, prevLon = lon
  let entryPoint: { lat: number; lon: number } | null = null
  let exitPoint: { lat: number; lon: number } | null = null
  let wasInRing = false
  const path: { lat: number; lon: number; altitude: number }[] = collectPath ? [{ lat, lon, altitude: alt }] : []
  const legs: DonutLeg[] = []
  const ringSegments: { lat: number; lon: number }[][] = []
  let currentRingSegment: { lat: number; lon: number }[] = []
  let zigzagCount = 0

  // Ring-Breite und Puffer berechnen
  const ringWidth = outerR - innerR
  // Wechsel-Puffer: Wenn wir näher als 20% der Ring-Breite am Rand sind
  const switchBuffer = Math.max(ringWidth * 0.2, 100)

  function checkRing() {
    const d = distToCenter(lat, lon, centerLat, centerLon)
    const inRing = isInRing(d, innerR, outerR)
    if (inRing) {
      const segDist = calculateDistance(prevLat, prevLon, lat, lon)
      trackInRing += segDist
      if (!wasInRing) {
        entryPoint = entryPoint || { lat, lon }
        currentRingSegment = [{ lat, lon }]
      } else {
        if (collectPath) currentRingSegment.push({ lat, lon })
      }
    } else if (wasInRing) {
      exitPoint = { lat: prevLat, lon: prevLon }
      if (currentRingSegment.length > 1) ringSegments.push([...currentRingSegment])
      currentRingSegment = []
    }
    wasInRing = inRing
    return { dist: d, inRing }
  }

  /**
   * Prüft ob der Wind auf der aktuellen Höhe den Ballon aus dem Ring treibt.
   * Gibt true zurück wenn ein Höhenwechsel sinnvoll ist.
   */
  function shouldSwitch(currentDist: number): boolean {
    // Zu nah am äußeren Rand und Wind treibt nach außen
    if (currentDist > outerR - switchBuffer) {
      const w = interpolateWind(alt, windLayers)
      const driftBrg = (w.direction + 180) % 360
      const brgToCenter = calculateBearing(lat, lon, centerLat, centerLon)
      // Winkel zwischen Drift und Richtung zum Mittelpunkt
      let angleDiff = driftBrg - brgToCenter
      while (angleDiff > 180) angleDiff -= 360
      while (angleDiff < -180) angleDiff += 360
      // Wind treibt weg vom Zentrum (>90° Abweichung)
      if (Math.abs(angleDiff) > 90) return true
    }
    // Zu nah am inneren Rand und Wind treibt nach innen
    if (currentDist < innerR + switchBuffer) {
      const w = interpolateWind(alt, windLayers)
      const driftBrg = (w.direction + 180) % 360
      const brgFromCenter = calculateBearing(centerLat, centerLon, lat, lon)
      let angleDiff = driftBrg - brgFromCenter
      while (angleDiff > 180) angleDiff -= 360
      while (angleDiff < -180) angleDiff += 360
      // Wind treibt zum Zentrum (>90° Abweichung)
      if (Math.abs(angleDiff) > 90) return true
    }
    return false
  }

  // Aktuelles Ziel: abwechselnd altA und altB
  let currentTarget = altA
  let nextTarget = altB
  // Max Pendel-Wechsel (Sicherheit gegen Endlosschleife)
  const maxSwitches = 30
  // Zähler für "außerhalb des Rings ohne Verbesserung"
  let outsideStale = 0
  let hasBeenInRing = false

  // ── Initiales Steigen/Sinken zum ersten Ziel ──
  function doClimbSink(target: number): boolean {
    const altDiff = target - alt
    if (Math.abs(altDiff) <= 3) return true
    const dir = altDiff > 0 ? 1 : -1
    const legStart = totalTime
    const legTrackStart = trackInRing
    const w0 = interpolateWind(alt, windLayers)

    while ((dir > 0 && alt < target) || (dir < 0 && alt > target)) {
      prevLat = lat; prevLon = lon
      const w = interpolateWind(alt, windLayers)
      const drift = (w.direction + 180) % 360
      const dest = calculateDestination(lat, lon, drift, w.speedMs)
      lat = dest.lat; lon = dest.lon
      alt += dir * rate
      totalTime++
      checkRing()
      if (collectPath && totalTime % 5 === 0) path.push({ lat, lon, altitude: alt })
      if (totalTime > MAX_SIM_TIME) return false
    }
    alt = target

    legs.push({
      targetAltitude: target, targetAltitudeFt: toFt50(target),
      action: altDiff > 0 ? 'STEIGEN' : 'SINKEN',
      rate: Math.round(rate * 10) / 10, rateFtMin: Math.round(rate * 3.28084 * 60),
      durationSec: totalTime - legStart,
      windDirection: Math.round(w0.direction), windSpeedKmh: Math.round(w0.speedMs * 3.6),
      trackInRing: Math.round(trackInRing - legTrackStart)
    })
    return true
  }

  // Steige/Sinke zum ersten Ziel
  if (!doClimbSink(currentTarget)) {
    if (collectPath) path.push({ lat, lon, altitude: alt })
    return { trackInRing: Math.round(trackInRing), totalTime, zigzagCount, path, legs, entryPoint, exitPoint, ringSegments }
  }

  // ── Haupt-Zickzack-Schleife ──
  while (totalTime < MAX_SIM_TIME && zigzagCount < maxSwitches) {
    // Drift auf aktueller Höhe
    const driftStart = totalTime
    const driftTrackStart = trackInRing
    const dw = interpolateWind(alt, windLayers)
    let needSwitch = false

    for (let d = 0; d < 1800; d++) {  // Max 30 min Drift pro Segment
      prevLat = lat; prevLon = lon
      const w = interpolateWind(alt, windLayers)
      const drift = (w.direction + 180) % 360
      const dest = calculateDestination(lat, lon, drift, w.speedMs)
      lat = dest.lat; lon = dest.lon
      totalTime++

      const { dist, inRing } = checkRing()
      if (collectPath && totalTime % 5 === 0) path.push({ lat, lon, altitude: alt })

      if (inRing) {
        hasBeenInRing = true
        outsideStale = 0
      } else {
        outsideStale++
        // Wenn wir schon im Ring waren und jetzt >60s draußen → Wechsel
        if (hasBeenInRing && outsideStale > 60) {
          needSwitch = true
          break
        }
        // Wenn wir noch nie im Ring waren: großzügig warten (bis zu 20 min)
        if (!hasBeenInRing && d > 1200) break
      }

      // Prüfe ob Wechsel sinnvoll ist
      if (inRing && shouldSwitch(dist)) {
        needSwitch = true
        break
      }

      if (totalTime > MAX_SIM_TIME) break
    }

    const driftDuration = totalTime - driftStart
    if (driftDuration > 3) {
      legs.push({
        targetAltitude: alt, targetAltitudeFt: toFt50(alt), action: 'DRIFT',
        rate: 0, rateFtMin: 0, durationSec: driftDuration,
        windDirection: Math.round(dw.direction), windSpeedKmh: Math.round(dw.speedMs * 3.6),
        trackInRing: Math.round(trackInRing - driftTrackStart)
      })
    }

    if (totalTime > MAX_SIM_TIME) break

    // Wechsel zur anderen Höhe
    if (needSwitch) {
      // Ist die andere Höhe überhaupt anders?
      if (Math.abs(nextTarget - alt) > 10) {
        zigzagCount++
        if (!doClimbSink(nextTarget)) break

        // Tausche Ziele
        const temp = currentTarget
        currentTarget = nextTarget
        nextTarget = temp
        outsideStale = 0
      } else {
        // Gleiche Höhe — kein sinnvoller Wechsel möglich
        break
      }
    } else {
      // Kein Wechsel nötig und Drift beendet → sind wahrscheinlich raus
      break
    }
  }

  // Letztes Ring-Segment abschließen
  if (wasInRing && currentRingSegment.length > 1) {
    ringSegments.push([...currentRingSegment])
  }

  if (collectPath) path.push({ lat, lon, altitude: alt })

  return {
    trackInRing: Math.round(trackInRing),
    totalTime, zigzagCount, path, legs,
    entryPoint, exitPoint, ringSegments
  }
}

// ═══════════════════════════════════════════════════════════════════
// Hauptberechnung
// ═══════════════════════════════════════════════════════════════════

export function calculateDonut(input: DonutInput): DonutResult | null {
  const { pilotLat, pilotLon, pilotAltitude, innerRadius, outerRadius,
          minCenterDist, groundElevation, windLayers } = input

  if (windLayers.length === 0) return null

  const allAlts = windLayers.map(l => l.altitude)
  const minAlt = Math.max(groundElevation + 20, Math.min(...allAlts))
  const maxAlt = Math.max(...allAlts)

  // Kandidaten-Höhen (nur Windschichten, kein 75m-Raster — spart Rechenzeit)
  const candidates: number[] = []
  for (const a of allAlts) {
    if (a >= minAlt && a <= maxAlt) candidates.push(a)
  }
  if (pilotAltitude >= minAlt && pilotAltitude <= maxAlt) candidates.push(pilotAltitude)
  const uniqueAlts = [...new Set(candidates.map(a => Math.round(a)))].sort((a, b) => a - b)
  if (uniqueAlts.length === 0) return null

  // ── Alle Höhen-Paare für Zickzack ──
  // Paare von Höhen die möglichst gegenläufigen Wind haben
  interface AltPair { altA: number; altB: number; angleDiff: number }
  const altPairs: AltPair[] = []

  for (let i = 0; i < uniqueAlts.length; i++) {
    for (let j = i + 1; j < uniqueAlts.length; j++) {
      const wA = interpolateWind(uniqueAlts[i], windLayers)
      const wB = interpolateWind(uniqueAlts[j], windLayers)
      // Drift-Richtung (wohin der Ballon fliegt)
      const driftA = (wA.direction + 180) % 360
      const driftB = (wB.direction + 180) % 360
      let angleDiff = Math.abs(driftA - driftB)
      if (angleDiff > 180) angleDiff = 360 - angleDiff
      // Paare mit >20° Unterschied sind fürs Pendeln geeignet
      if (angleDiff > 20) {
        altPairs.push({ altA: uniqueAlts[i], altB: uniqueAlts[j], angleDiff })
      }
    }
  }

  // Sortiere: größter Winkelunterschied zuerst (gegenläufige Winde = bestes Pendel)
  altPairs.sort((a, b) => b.angleDiff - a.angleDiff)

  // Einzel-Höhen hinzufügen (kein Pendel, einfach durchdriften)
  for (const a of uniqueAlts) {
    altPairs.push({ altA: a, altB: a, angleDiff: 0 })
  }

  // Falls keine guten Paare: nimm alle Kombinationen
  if (altPairs.filter(p => p.angleDiff > 0).length === 0) {
    for (let i = 0; i < uniqueAlts.length; i++) {
      for (let j = i + 1; j < uniqueAlts.length; j++) {
        altPairs.push({ altA: uniqueAlts[i], altB: uniqueAlts[j], angleDiff: 0 })
      }
    }
  }

  // Limitiere auf Top-15 Paare für Performance
  const topPairs = altPairs.slice(0, 15)

  // ── Phase 1: Donut-Platzierung — 36 Richtungen × 3 Abstände ──
  const bearings: number[] = []
  for (let b = 0; b < 360; b += 10) bearings.push(b)
  const distances = [minCenterDist, minCenterDist + 300, minCenterDist + 600, minCenterDist + 1000]

  interface BestCandidate {
    centerLat: number; centerLon: number
    bearing: number; distance: number
    altA: number; altB: number
    trackInRing: number; totalTime: number; zigzagCount: number
  }

  let best: BestCandidate | null = null

  // Grobe Suche: Richtungen × Abstände × Top Höhen-Paare
  for (const brg of bearings) {
    for (const dist of distances) {
      const center = calculateDestination(pilotLat, pilotLon, brg, dist)

      // Teste Top-5 Höhen-Paare pro Richtung (Performance)
      for (const pair of topPairs.slice(0, 5)) {
        const sim = simulateZigzag(
          pilotLat, pilotLon, pilotAltitude,
          pair.altA, pair.altB, RATE,
          center.lat, center.lon,
          innerRadius, outerRadius,
          groundElevation, windLayers, false
        )

        if (!best || sim.trackInRing > best.trackInRing ||
            (sim.trackInRing === best.trackInRing && sim.totalTime < best.totalTime)) {
          best = {
            centerLat: center.lat, centerLon: center.lon,
            bearing: brg, distance: dist,
            altA: pair.altA, altB: pair.altB,
            trackInRing: sim.trackInRing,
            totalTime: sim.totalTime,
            zigzagCount: sim.zigzagCount
          }
        }
      }
    }
  }

  if (!best || best.trackInRing === 0) return null

  // ── Phase 2: Fein-Optimierung — Richtung ±8°, Abstand ±200m, alle Paare ──
  const fineBearings: number[] = []
  for (let b = best.bearing - 8; b <= best.bearing + 8; b += 2) {
    fineBearings.push(((b % 360) + 360) % 360)
  }
  const fineDists = [best.distance - 200, best.distance, best.distance + 200]

  for (const brg of fineBearings) {
    for (const dist of fineDists) {
      if (dist < minCenterDist) continue
      const center = calculateDestination(pilotLat, pilotLon, brg, dist)

      for (const pair of topPairs) {
        const sim = simulateZigzag(
          pilotLat, pilotLon, pilotAltitude,
          pair.altA, pair.altB, RATE,
          center.lat, center.lon,
          innerRadius, outerRadius,
          groundElevation, windLayers, false
        )

        if (sim.trackInRing > best.trackInRing ||
            (sim.trackInRing === best.trackInRing && sim.totalTime < best.totalTime)) {
          best = {
            centerLat: center.lat, centerLon: center.lon,
            bearing: brg, distance: dist,
            altA: pair.altA, altB: pair.altB,
            trackInRing: sim.trackInRing,
            totalTime: sim.totalTime,
            zigzagCount: sim.zigzagCount
          }
        }
      }
    }
  }

  // ── Finales Rendering mit Pfad-Sammlung ──
  const finalSim = simulateZigzag(
    pilotLat, pilotLon, pilotAltitude,
    best.altA, best.altB, RATE,
    best.centerLat, best.centerLon,
    innerRadius, outerRadius,
    groundElevation, windLayers, true
  )

  // Anweisung
  const firstLeg = finalSim.legs[0]
  let instruction = 'HALTEN'
  let instructionAltFt = toFt50(pilotAltitude)
  let instructionAction: DonutResult['instructionAction'] = 'HALTEN'
  let recommendedRate = 0, recommendedRateFtMin = 0

  if (firstLeg && firstLeg.action !== 'DRIFT') {
    instructionAltFt = firstLeg.targetAltitudeFt
    instructionAction = firstLeg.action
    instruction = `${firstLeg.action} auf ${instructionAltFt} ft`
    recommendedRate = firstLeg.rate
    recommendedRateFtMin = firstLeg.rateFtMin
  }

  return {
    centerLat: best.centerLat,
    centerLon: best.centerLon,
    centerBearing: Math.round(best.bearing),
    centerDistance: Math.round(best.distance),
    trackInRing: finalSim.trackInRing,
    totalTimeSec: finalSim.totalTime,
    entryPoint: finalSim.entryPoint,
    exitPoint: finalSim.exitPoint,
    zigzagCount: finalSim.zigzagCount,
    altA: best.altA,
    altB: best.altB,
    legs: finalSim.legs,
    predictedPath: finalSim.path,
    ringSegments: finalSim.ringSegments,
    instruction, instructionAltFt, instructionAction,
    recommendedRate, recommendedRateFtMin
  }
}
