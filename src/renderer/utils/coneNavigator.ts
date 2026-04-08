/**
 * PDG Cone Navigator — Neuaufbau
 *
 * Ablauf:
 * 1. Pilot gibt Höhenfenster ein (aktuelle Höhe bis max Höhe)
 * 2. Nur Windschichten in diesem Fenster werden betrachtet
 * 3. Finde die Höhe mit der größten Windstreuung (links/rechts Korrektur)
 * 4. Berechne Deklarationspunkt auf dieser Höhe (min. 500m entfernt)
 * 5. Zeichne Kegel: Spitze = Deklaration, Öffnung = Richtung Pilot
 * 6. Blaue Linie: Vom Piloten zur Kegelmitte (dort auf Zielhöhe ankommen)
 * 7. Ab Kegelmitte: Pilot korrigiert mit hoch/runter
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

export interface ConeInput {
  lat: number
  lon: number
  altitude: number        // Meter MSL (aktuelle Höhe)
  direction: 'up' | 'down'
  minAltChangeFt: number  // Min. Höhenänderung (ft, z.B. 1000)
  maxAltitudeFt: number   // Max. absolute Höhe (ft, z.B. 4000), 0 = kein Limit
  minDistanceM: number    // Min. Horizontaldistanz (m, z.B. 500)
  windLayers: WindLayer[]
  goalLat: number
  goalLon: number
}

export interface TurnLayer {
  altitude: number       // Meter — Optimale Zielhöhe
  altitudeFt: number     // Feet (auf 50ft gerundet)
  driftBearing: number   // Drift-Richtung auf dieser Höhe (°)
  windSpeed: number      // km/h
  steerRange: number     // Steuerbereich in Grad
  leftAlt: number        // Meter — Höhe für Links-Korrektur
  leftAltFt: number
  leftBearing: number    // Drift-Richtung links (°)
  rightAlt: number       // Meter — Höhe für Rechts-Korrektur
  rightAltFt: number
  rightBearing: number   // Drift-Richtung rechts (°)
  warning: string | null // Warnung wenn Korrektur-Sprünge zu groß
}

export interface ConeResult {
  target: { lat: number; lon: number; altitude: number; altitudeFt: number }
  distToGoal: number
  flightTime: number
  turnLayer: TurnLayer
  requiredRate: number      // m/s
  requiredRateFtMin: number // ft/min
  cone: {
    center: { lat: number; lon: number }[]
    left: { lat: number; lon: number }[]
    right: { lat: number; lon: number }[]
  }
  path: { lat: number; lon: number; altitude: number }[]
}

export interface ConeGuidance {
  targetAltFt: number
  action: 'STEIGEN' | 'SINKEN' | 'HALTEN'
  reason: string
  driftBearing: number
  bearingToTarget: number
  angleOff: number
  distToTarget: number
  altDiff: number
  leftAltFt: number
  leftAngle: number
  rightAltFt: number
  rightAngle: number
  centerAltFt: number
  centerAngle: number
  // Live-Pfad: Wo komme ich an wenn ich mit aktueller Vario weitersteige?
  livePath: { lat: number; lon: number; altitude: number }[]
}

// ═══════════════════════════════════════════════════════════════════
// Hilfsfunktionen
// ═══════════════════════════════════════════════════════════════════

// Meter → Feet, gerundet auf 50ft
const toFt50 = (m: number) => Math.round(m * 3.28084 / 50) * 50

const CLIMB_RATE = 5     // Max Steig-/Sinkrate (m/s)
const PATH_STEP = 5      // Pfadpunkt alle 5 Sekunden

// Winkel normalisieren auf -180..+180
function normalizeAngle(a: number): number {
  while (a > 180) a -= 360
  while (a < -180) a += 360
  return a
}

// ═══════════════════════════════════════════════════════════════════
// 1. Beste Drehschicht finden
// ═══════════════════════════════════════════════════════════════════
//
// Logik (v4 — realistisch für Ballonfahrt):
// - Drehschicht = Center-Schicht wo der Pilot fährt
// - Links/Rechts-Korrektur innerhalb von MAX_CORR_ALT (500ft/~150m)
//   gesucht — erkennt Tendenzen auch wenn der direkte Nachbar wenig dreht
// - Bevorzugt nahe Korrektur-Schichten (Score bestraft große Höhensprünge)
// - Goal-Richtung fließt in die Bewertung ein

const MAX_CORR_ALT = 152  // ~500ft — maximaler Höhensprung für Korrektur

function findBestTurnLayer(
  minAltM: number, maxAltM: number,
  windLayers: WindLayer[],
  pilotAltM: number = 0,
  goalBearing: number = -1  // Bearing Pilot→Goal in Grad, -1 = nicht berücksichtigen
): TurnLayer | null {
  // Alle Schichten im erweiterten Bereich (Pilot bis Fenstergrenzen), sortiert nach Höhe
  const corrMin = Math.min(minAltM, pilotAltM)
  const corrMax = Math.max(maxAltM, pilotAltM)
  const allSorted = windLayers
    .filter(l => l.altitude >= corrMin && l.altitude <= corrMax && l.speed > 0.5)
    .sort((a, b) => a.altitude - b.altitude)

  if (allSorted.length < 2) return null

  let best: TurnLayer | null = null
  let bestScore = 0

  for (let i = 0; i < allSorted.length; i++) {
    const center = allSorted[i]

    // Center muss im Höhenfenster liegen
    if (center.altitude < minAltM || center.altitude > maxAltM) continue

    const centerDrift = (center.direction + 180) % 360

    // Suche beste Links- und Rechts-Korrektur innerhalb von 500ft
    let leftAngle = 0, leftAlt = center.altitude
    let rightAngle = 0, rightAlt = center.altitude

    for (const n of allSorted) {
      if (n.altitude === center.altitude) continue
      // Nur Schichten innerhalb von MAX_CORR_ALT prüfen
      if (Math.abs(n.altitude - center.altitude) > MAX_CORR_ALT) continue

      const drift = (n.direction + 180) % 360
      const angle = normalizeAngle(drift - centerDrift)

      // Nähere Schicht bevorzugen bei gleichem Winkel
      if (angle < leftAngle) {
        leftAngle = angle; leftAlt = n.altitude
      } else if (angle < 0 && angle === leftAngle && Math.abs(n.altitude - center.altitude) < Math.abs(leftAlt - center.altitude)) {
        leftAlt = n.altitude  // Gleicher Winkel, aber näher
      }

      if (angle > rightAngle) {
        rightAngle = angle; rightAlt = n.altitude
      } else if (angle > 0 && angle === rightAngle && Math.abs(n.altitude - center.altitude) < Math.abs(rightAlt - center.altitude)) {
        rightAlt = n.altitude
      }
    }

    const steerRange = rightAngle - leftAngle
    if (steerRange < 2) continue  // Mindestens 2° Streuung

    // Korrektur-Aufwand
    const leftDist = Math.abs(leftAlt - center.altitude)
    const rightDist = Math.abs(rightAlt - center.altitude)
    const maxJump = Math.max(leftDist, rightDist, 30)

    // Windstärke auf Center-Höhe
    const windFactor = Math.max(center.speed, 2)

    // Score: Streuung × Wind / Korrektur-Aufwand
    let score = (steerRange * windFactor) / maxJump

    // Goal-Richtung
    if (goalBearing >= 0) {
      const driftToGoalAngle = Math.abs(normalizeAngle(centerDrift - goalBearing))
      const alignmentFactor = 0.7 + 0.8 * Math.cos(driftToGoalAngle * Math.PI / 180)
      score *= alignmentFactor
    }

    if (score > bestScore) {
      bestScore = score
      const leftDriftBearing = (interpolateWind(leftAlt, windLayers).direction + 180) % 360
      const rightDriftBearing = (interpolateWind(rightAlt, windLayers).direction + 180) % 360

      let warning: string | null = null
      if (leftDist > 150 || rightDist > 150) {
        const parts: string[] = []
        if (leftDist > 150) parts.push(`Links ${toFt50(leftAlt)}ft (${Math.round(leftDist * 3.28084)}ft Sprung)`)
        if (rightDist > 150) parts.push(`Rechts ${toFt50(rightAlt)}ft (${Math.round(rightDist * 3.28084)}ft Sprung)`)
        warning = `⚠ Großer Höhensprung: ${parts.join(', ')}`
      }

      best = {
        altitude: center.altitude,
        altitudeFt: toFt50(center.altitude),
        driftBearing: Math.round(centerDrift),
        windSpeed: Math.round(center.speed),
        steerRange: Math.round(steerRange),
        leftAlt, leftAltFt: toFt50(leftAlt), leftBearing: Math.round(leftDriftBearing),
        rightAlt, rightAltFt: toFt50(rightAlt), rightBearing: Math.round(rightDriftBearing),
        warning
      }
    }
  }

  // Fallback: Wenn keine Drehschicht gefunden, nimm die Schicht mit dem stärksten Wind
  // (= maximale Drift-Distanz, auch wenn keine Korrektur möglich ist)
  if (!best && allSorted.length >= 1) {
    const strongest = allSorted.reduce((a, b) => a.speed > b.speed ? a : b)
    if (strongest.altitude >= minAltM && strongest.altitude <= maxAltM) {
      const drift = (strongest.direction + 180) % 360
      best = {
        altitude: strongest.altitude,
        altitudeFt: toFt50(strongest.altitude),
        driftBearing: Math.round(drift),
        windSpeed: Math.round(strongest.speed),
        steerRange: 0,
        leftAlt: strongest.altitude, leftAltFt: toFt50(strongest.altitude), leftBearing: Math.round(drift),
        rightAlt: strongest.altitude, rightAltFt: toFt50(strongest.altitude), rightBearing: Math.round(drift),
        warning: '⚠ Keine Drehschicht – nur Drift, keine Links/Rechts Korrektur möglich'
      }
    }
  }

  return best
}

// ═══════════════════════════════════════════════════════════════════
// 2. Kegel berechnen
// ═══════════════════════════════════════════════════════════════════

export function calculateCone(input: ConeInput): ConeResult | null {
  const { lat, lon, altitude, direction, minAltChangeFt, maxAltitudeFt, minDistanceM, windLayers, goalLat, goalLon } = input

  if (windLayers.length === 0) return null

  // Höhenfenster: Von aktueller Höhe bis zur eingegebenen Grenze
  const currentAltFt = altitude * 3.28084
  let minAltM: number, maxAltM: number

  // Höchste/tiefste verfügbare Schicht als Fallback
  const allAlts = windLayers.map(l => l.altitude)
  const highestLayer = Math.max(...allAlts)
  const lowestLayer = Math.min(...allAlts)

  if (direction === 'up') {
    minAltM = altitude + minAltChangeFt * 0.3048  // Mindestens so viel steigen
    maxAltM = maxAltitudeFt > 0 ? maxAltitudeFt * 0.3048 : highestLayer
    if (maxAltM <= minAltM) maxAltM = highestLayer
  } else {
    maxAltM = altitude - minAltChangeFt * 0.3048  // Mindestens so viel sinken
    minAltM = maxAltitudeFt > 0 ? maxAltitudeFt * 0.3048 : lowestLayer
    if (minAltM >= maxAltM) minAltM = lowestLayer
  }

  // Bearing vom Piloten zum Goal (für Goal-bewusste Drehschicht-Auswahl)
  const goalBrg = calculateBearing(lat, lon, goalLat, goalLon)

  // Beste Drehschicht finden (nur Schichten im Fenster, Goal-Richtung berücksichtigt)
  const turnLayer = findBestTurnLayer(minAltM, maxAltM, windLayers, altitude, goalBrg)
  if (!turnLayer) {
    console.log('[Cone] Keine Drehschicht im Fenster', toFt50(minAltM), '-', toFt50(maxAltM), 'ft')
    return null
  }

  // Wind auf Drehschicht-Höhe
  const centerWind = interpolateWind(turnLayer.altitude, windLayers)
  const cDrift = (centerWind.direction + 180) % 360

  // ── Deklarationspunkt berechnen ──
  const altDiff = turnLayer.altitude - altitude
  const climbDir = altDiff > 0 ? 1 : -1

  // 1. Wie viel Zeit hat der Pilot bis zur minDistanz? (= minimale Flugzeit)
  const avgWindMs = centerWind.speedMs > 0.1 ? centerWind.speedMs : 2
  const minTimeSec = minDistanceM / avgWindMs

  // 2. Optimale Rate = Höhendifferenz / verfügbare Zeit, begrenzt auf CLIMB_RATE
  const rawRate = minTimeSec > 0 ? Math.abs(altDiff) / minTimeSec : CLIMB_RATE
  const useRate = Math.min(rawRate, CLIMB_RATE)

  // 3. Tatsächliche Steigzeit mit dieser Rate
  const climbTimeSec = Math.abs(altDiff) / useRate

  // 4. Simuliere: Pilot steigt/sinkt mit useRate, driftet dabei mit Wind pro Höhe
  //    → Wo kommt er auf Zielhöhe an? Das ist die Kegelmitte.
  let simLat = lat, simLon = lon
  let simAlt = altitude

  for (let t = 0; t < climbTimeSec && t < 3600; t++) {
    simAlt += useRate * climbDir
    if ((climbDir > 0 && simAlt > turnLayer.altitude) || (climbDir < 0 && simAlt < turnLayer.altitude)) {
      simAlt = turnLayer.altitude
    }
    const w = interpolateWind(simAlt, windLayers)
    const pos = calculateDestination(simLat, simLon, (w.direction + 180) % 360, w.speedMs)
    simLat = pos.lat; simLon = pos.lon
  }

  // 5. Wenn Kegelmitte noch zu nah (< minDistanz), weiter auf Zielhöhe driften
  let totalTime = Math.round(climbTimeSec)
  while (calculateDistance(lat, lon, simLat, simLon) < minDistanceM && totalTime < 3600) {
    totalTime++
    const pos = calculateDestination(simLat, simLon, cDrift, centerWind.speedMs)
    simLat = pos.lat; simLon = pos.lon
  }

  // Kegelmitte = wo der Pilot auf Zielhöhe ankommt
  const coneMidLat = simLat, coneMidLon = simLon

  // 4. Deklarationspunkt = Kegelmitte + halbe Kegellänge weiter auf Center-Drift
  //    (damit Kegelmitte in der Mitte liegt und der Pilot noch Korrekturspielraum hat)
  const coneHalfDuration = Math.max(totalTime / 2, 150)  // Halber Kegel mindestens 150s
  let declLat = coneMidLat, declLon = coneMidLon
  for (let t = 0; t < coneHalfDuration; t++) {
    const pos = calculateDestination(declLat, declLon, cDrift, centerWind.speedMs)
    declLat = pos.lat; declLon = pos.lon
  }
  const declAlt = turnLayer.altitude

  // ── Kegel: Vom Deklarationspunkt Richtung Pilot ──
  // Spitze = am weitesten weg, Öffnung = Richtung Pilot
  // Der Kegel zeigt wo der Pilot durch Höhenänderung hinkorrigieren kann
  const leftWind = interpolateWind(turnLayer.leftAlt, windLayers)
  const rightWind = interpolateWind(turnLayer.rightAlt, windLayers)
  const lDrift = (leftWind.direction + 180) % 360
  const rDrift = (rightWind.direction + 180) % 360

  // Rückwärts vom Deklarationspunkt (gegen den Wind)
  const cBack = (cDrift + 180) % 360
  const lBack = (lDrift + 180) % 360
  const rBack = (rDrift + 180) % 360

  const coneDuration = Math.max(totalTime, 300)  // Mindestens 300s

  // Rückwärts-Simulation: Deklaration → Öffnung (Richtung Pilot)
  let cLat = declLat, cLon = declLon
  let lLat = declLat, lLon = declLon
  let rLat = declLat, rLon = declLon

  const tempC: { lat: number; lon: number }[] = [{ lat: declLat, lon: declLon }]
  const tempL: { lat: number; lon: number }[] = [{ lat: declLat, lon: declLon }]
  const tempR: { lat: number; lon: number }[] = [{ lat: declLat, lon: declLon }]

  for (let t = 1; t <= coneDuration; t++) {
    const cP = calculateDestination(cLat, cLon, cBack, centerWind.speedMs)
    cLat = cP.lat; cLon = cP.lon

    const lP = calculateDestination(lLat, lLon, lBack, leftWind.speedMs)
    lLat = lP.lat; lLon = lP.lon

    const rP = calculateDestination(rLat, rLon, rBack, rightWind.speedMs)
    rLat = rP.lat; rLon = rP.lon

    if (t % 10 === 0) {
      tempC.push({ lat: cLat, lon: cLon })
      tempL.push({ lat: lLat, lon: lLon })
      tempR.push({ lat: rLat, lon: rLon })
    }
  }

  // Umkehren: Öffnung (Pilot) → Spitze (Deklaration)
  const coneCenter = [...tempC].reverse()
  const coneLeft = [...tempL].reverse()
  const coneRight = [...tempR].reverse()

  // ── Pfad: Vom Piloten zur Kegelmitte ──
  const path: { lat: number; lon: number; altitude: number }[] = [{ lat, lon, altitude }]

  // Gerader Pfad vom Start zur Kegelmitte, Höhe steigt linear
  const distToMid = calculateDistance(lat, lon, coneMidLat, coneMidLon)
  const steps = Math.max(Math.floor(climbTimeSec / PATH_STEP), 1)

  for (let i = 1; i <= steps; i++) {
    const frac = i / steps
    const pLat = lat + (coneMidLat - lat) * frac
    const pLon = lon + (coneMidLon - lon) * frac
    const pAlt = altitude + altDiff * frac
    path.push({ lat: pLat, lon: pLon, altitude: pAlt })
  }

  // Rate = die tatsächlich verwendete Rate (begrenzt auf max CLIMB_RATE)
  const requiredRate = Math.round(useRate * climbDir * 10) / 10
  const requiredRateFtMin = Math.round(requiredRate * 3.28084 * 60)

  const distToGoal = calculateDistance(declLat, declLon, goalLat, goalLon)

  return {
    target: { lat: declLat, lon: declLon, altitude: declAlt, altitudeFt: turnLayer.altitudeFt },
    distToGoal: Math.round(distToGoal),
    flightTime: Math.round(climbTimeSec),
    turnLayer,
    requiredRate: Math.round(requiredRate * 10) / 10,
    requiredRateFtMin,
    cone: { center: coneCenter, left: coneLeft, right: coneRight },
    path
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. Live-Korrektur
// ═══════════════════════════════════════════════════════════════════

export function calculateConeGuidance(
  currentLat: number, currentLon: number, currentAlt: number,
  targetLat: number, targetLon: number, targetAlt: number,
  turnLayer: TurnLayer,
  windLayers: WindLayer[],
  varioMs: number = 0
): ConeGuidance {
  const distToTarget = calculateDistance(currentLat, currentLon, targetLat, targetLon)
  const bearingToTarget = calculateBearing(currentLat, currentLon, targetLat, targetLon)
  const altDiffFt = Math.round((targetAlt - currentAlt) * 3.28084)

  // Aktuelle Drift
  const currentWind = interpolateWind(currentAlt, windLayers)
  const currentDrift = (currentWind.direction + 180) % 360
  const angleOff = normalizeAngle(currentDrift - bearingToTarget)

  // Drift-Winkel für Links/Rechts/Mitte relativ zum Ziel
  const leftDrift = (interpolateWind(turnLayer.leftAlt, windLayers).direction + 180) % 360
  const leftAngle = normalizeAngle(leftDrift - bearingToTarget)

  const rightDrift = (interpolateWind(turnLayer.rightAlt, windLayers).direction + 180) % 360
  const rightAngle = normalizeAngle(rightDrift - bearingToTarget)

  const centerDrift = (interpolateWind(turnLayer.altitude, windLayers).direction + 180) % 360
  const centerAngle = normalizeAngle(centerDrift - bearingToTarget)

  // Entscheidung
  let action: ConeGuidance['action']
  let reason: string
  let targetAltFt: number

  const turnAltFt = toFt50(turnLayer.altitude)
  const currentAltFt = toFt50(currentAlt)
  const tolerance = 3

  if (Math.abs(angleOff) <= tolerance) {
    // Auf Kurs → zurück auf Drehschicht
    targetAltFt = turnAltFt
    if (Math.abs(currentAltFt - turnAltFt) < 50) {
      action = 'HALTEN'
      reason = `Auf Kurs – Höhe halten (${turnAltFt}ft)`
    } else {
      action = turnLayer.altitude > currentAlt ? 'STEIGEN' : 'SINKEN'
      reason = `Auf Kurs – zurück auf ${turnAltFt}ft`
    }
  } else if (angleOff > tolerance) {
    // Rechts vorbei → Links korrigieren
    action = turnLayer.leftAlt < currentAlt ? 'SINKEN' : 'STEIGEN'
    reason = `Links korrigieren (${turnLayer.leftAltFt}ft)`
    targetAltFt = turnLayer.leftAltFt
  } else {
    // Links vorbei → Rechts korrigieren
    action = turnLayer.rightAlt < currentAlt ? 'SINKEN' : 'STEIGEN'
    reason = `Rechts korrigieren (${turnLayer.rightAltFt}ft)`
    targetAltFt = turnLayer.rightAltFt
  }

  // Live-Pfad: Simuliere wo der Pilot ankommt wenn er mit aktuellem Vario weitersteigt
  // Sekunde für Sekunde: Höhe ändert sich mit varioMs, Wind pro Höhenstufe
  const livePath: { lat: number; lon: number; altitude: number }[] = [{ lat: currentLat, lon: currentLon, altitude: currentAlt }]
  let pLat = currentLat, pLon = currentLon, pAlt = currentAlt
  const effectiveVario = Math.abs(varioMs) > 0.1 ? varioMs : (targetAlt > currentAlt ? CLIMB_RATE : -CLIMB_RATE)

  for (let t = 1; t < 1800; t++) {
    // Höhe ändern
    pAlt += effectiveVario
    // Zielhöhe erreicht → stoppen
    if ((effectiveVario > 0 && pAlt >= targetAlt) || (effectiveVario < 0 && pAlt <= targetAlt)) {
      pAlt = targetAlt
      // Wind auf Zielhöhe für letzten Schritt
      const w = interpolateWind(pAlt, windLayers)
      const pos = calculateDestination(pLat, pLon, (w.direction + 180) % 360, w.speedMs)
      pLat = pos.lat; pLon = pos.lon
      livePath.push({ lat: pLat, lon: pLon, altitude: pAlt })
      break
    }
    // Drift mit Wind auf aktueller Höhe
    const w = interpolateWind(pAlt, windLayers)
    const pos = calculateDestination(pLat, pLon, (w.direction + 180) % 360, w.speedMs)
    pLat = pos.lat; pLon = pos.lon
    if (t % PATH_STEP === 0) livePath.push({ lat: pLat, lon: pLon, altitude: pAlt })
  }

  return {
    targetAltFt, action, reason,
    driftBearing: Math.round(currentDrift),
    bearingToTarget: Math.round(bearingToTarget),
    angleOff: Math.round(angleOff),
    distToTarget: Math.round(distToTarget),
    altDiff: altDiffFt,
    leftAltFt: toFt50(turnLayer.leftAlt),
    leftAngle: Math.round(leftAngle),
    rightAltFt: toFt50(turnLayer.rightAlt),
    rightAngle: Math.round(rightAngle),
    centerAltFt: turnAltFt,
    centerAngle: Math.round(centerAngle),
    livePath
  }
}
