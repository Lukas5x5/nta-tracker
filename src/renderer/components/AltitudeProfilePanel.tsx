import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { TaskType } from '../../shared/types'

// ═══════════════════════════════════════════════════════════════════
// APT - Altitude Profile Task (Rule 15.21) — Live Flughilfe
// ═══════════════════════════════════════════════════════════════════

interface ProfilePoint {
  timeMinutes: number
  altitudeFt: number
}

interface HistoryPoint {
  timeMinutes: number
  actualFt: number
  targetFt: number
  layer: 'A' | 'B' | 'outside'
}

interface AltitudeProfilePanelProps {
  onClose: () => void
}

// Profil interpolieren: lineare Interpolation zwischen den definierten Punkten
function interpolateProfile(timeMinutes: number, points: ProfilePoint[]): number | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0].altitudeFt
  if (timeMinutes <= points[0].timeMinutes) return points[0].altitudeFt
  if (timeMinutes >= points[points.length - 1].timeMinutes) return points[points.length - 1].altitudeFt

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    if (timeMinutes >= p1.timeMinutes && timeMinutes <= p2.timeMinutes) {
      const fraction = (timeMinutes - p1.timeMinutes) / (p2.timeMinutes - p1.timeMinutes)
      return p1.altitudeFt + (p2.altitudeFt - p1.altitudeFt) * fraction
    }
  }
  return points[points.length - 1].altitudeFt
}

export function AltitudeProfilePanel({ onClose }: AltitudeProfilePanelProps) {
  const { baroData, gpsData, settings, activeTask } = useFlightStore()
  const isMetric = settings.variometerUnit === 'ms'
  // Konvertierung: intern immer ft/min, Anzeige je nach Einstellung
  const FPM_TO_MS = 1 / 196.85
  const rateToDisplay = (fpm: number) => isMetric ? fpm * FPM_TO_MS : fpm
  const rateUnit = isMetric ? 'm/s' : 'ft/min'

  // Setup State
  const [profilePoints, setProfilePoints] = useState<ProfilePoint[]>([
    { timeMinutes: 0, altitudeFt: 2500 },
    { timeMinutes: 2, altitudeFt: 3000 },
    { timeMinutes: 4, altitudeFt: 3000 },
    { timeMinutes: 6, altitudeFt: 2000 },
    { timeMinutes: 8, altitudeFt: 2000 },
  ])
  const [layerAFt, setLayerAFt] = useState(50)
  const [layerBFt, setLayerBFt] = useState(100)
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null)

  // Pre-Start Alignment & Countdown State
  const [phase, setPhase] = useState<'setup' | 'aligning' | 'countdown' | 'live' | 'finished'>('setup')
  const [countdown, setCountdown] = useState(3)
  const [alignDeviation, setAlignDeviation] = useState(0)

  // Auto-Load: Profil aus dem aktiven Task laden
  useEffect(() => {
    if (activeTask?.type === TaskType.APT && activeTask.aptProfile && activeTask.id !== loadedTaskId && phase === 'setup') {
      const { points, layerAFt: la, layerBFt: lb } = activeTask.aptProfile
      if (points.length >= 2) {
        setProfilePoints(points.map(p => ({ timeMinutes: p.timeMinutes, altitudeFt: p.altitudeFt })))
        setLayerAFt(la)
        setLayerBFt(lb)
        setLoadedTaskId(activeTask.id)
        console.log(`[APT] Profil aus Task "${activeTask.taskNumber || activeTask.name}" geladen: ${points.length} Punkte`)
      }
    }
  }, [activeTask, loadedTaskId, phase])

  // Live State
  const [isRunning, setIsRunning] = useState(false)
  const [taskStartTime, setTaskStartTime] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [currentDeviation, setCurrentDeviation] = useState(0)
  const [currentLayer, setCurrentLayer] = useState<'A' | 'B' | 'outside'>('outside')
  const [elapsedMinutes, setElapsedMinutes] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [lookahead, setLookahead] = useState<{
    action: 'STEIGEN' | 'SINKEN' | 'HALTEN'
    inMinutes: number
    targetAltFt: number
    altChangeFt: number
    requiredRateFtMin: number
    timeAvailableMin: number
    upcoming?: {
      action: 'STEIGEN' | 'SINKEN' | 'HALTEN'
      inSeconds: number
      rateFtMin: number
    }
  } | null>(null)

  // Save State
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [championships, setChampionships] = useState<{ id: string; name: string }[]>([])
  const [selectedChampId, setSelectedChampId] = useState<string>('')
  const [loadingChamps, setLoadingChamps] = useState(false)

  // Drag State
  const [aptPanelPos, setAptPanelPos] = useState<{ x: number; y: number } | null>(null)
  const [isAptDragging, setIsAptDragging] = useState(false)
  const aptDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; isTouch: boolean } | null>(null)

  const handleAptMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return
    e.preventDefault()
    const pos = aptPanelPos || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }
    setIsAptDragging(true)
    aptDragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y, isTouch: false }
  }

  const handleAptTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return
    const touch = e.touches[0]
    if (!touch) return
    const pos = aptPanelPos || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }
    setIsAptDragging(true)
    aptDragRef.current = { startX: touch.clientX, startY: touch.clientY, startPosX: pos.x, startPosY: pos.y, isTouch: true }
  }

  useEffect(() => {
    if (!isAptDragging || !aptDragRef.current) return
    const handleMove = (clientX: number, clientY: number) => {
      if (!aptDragRef.current) return
      setAptPanelPos({
        x: Math.max(0, Math.min(window.innerWidth, aptDragRef.current.startPosX + (clientX - aptDragRef.current.startX))),
        y: Math.max(0, Math.min(window.innerHeight, aptDragRef.current.startPosY + (clientY - aptDragRef.current.startY)))
      })
    }
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const handleTouchMove = (e: TouchEvent) => { const t = e.touches[0]; if (t) handleMove(t.clientX, t.clientY) }
    const handleEnd = () => { setIsAptDragging(false); aptDragRef.current = null }

    if (aptDragRef.current.isTouch) {
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    } else {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isAptDragging])

  const intervalRef = useRef<number | null>(null)

  // Gesamt-Dauer aus den Profil-Punkten
  const totalDuration = profilePoints.length > 0
    ? profilePoints[profilePoints.length - 1].timeMinutes
    : 8

  // Aktuelle Höhe in Feet
  const baroRef = useRef(baroData)
  const gpsRef = useRef(gpsData)
  baroRef.current = baroData
  gpsRef.current = gpsData

  const getCurrentAltFt = useCallback((): number => {
    const altM = baroRef.current?.pressureAltitude || gpsRef.current?.altitude || 0
    return altM * 3.28084
  }, [])

  // Profil-Startrate berechnen
  const profileStartRateFtMin = (() => {
    if (profilePoints.length < 2) return 0
    const p0 = profilePoints[0]
    const p1 = profilePoints[1]
    const altChange = p1.altitudeFt - p0.altitudeFt
    const timeDiff = p1.timeMinutes - p0.timeMinutes
    if (timeDiff <= 0 || Math.abs(altChange) < 10) return 0
    return altChange / timeDiff
  })()
  const hasStartRate = Math.abs(profileStartRateFtMin) > 10

  // ═══ Alignment & Countdown Phase ═══
  const alignIntervalRef = useRef<number | null>(null)
  const countdownRef = useRef<number | null>(null)
  const prevAltRef = useRef<number>(0)
  const currentVarioRef = useRef<number>(0)
  const altHistoryRef = useRef<{ alt: number; time: number }[]>([])

  useEffect(() => {
    if (phase !== 'aligning') {
      if (alignIntervalRef.current) {
        clearInterval(alignIntervalRef.current)
        alignIntervalRef.current = null
      }
      return
    }

    const startAlt = profilePoints[0]?.altitudeFt ?? 0
    const tolerance = layerAFt
    const initAlt = getCurrentAltFt()
    prevAltRef.current = initAlt
    altHistoryRef.current = [{ alt: initAlt, time: Date.now() }]

    alignIntervalRef.current = window.setInterval(() => {
      const currentAlt = getCurrentAltFt()
      const dev = currentAlt - startAlt
      setAlignDeviation(dev)

      const now = Date.now()
      altHistoryRef.current.push({ alt: currentAlt, time: now })
      altHistoryRef.current = altHistoryRef.current.filter(p => now - p.time <= 2000)

      const hist = altHistoryRef.current
      if (hist.length >= 2) {
        const oldest = hist[0]
        const dt = (now - oldest.time) / 60000
        if (dt > 0) {
          currentVarioRef.current = (currentAlt - oldest.alt) / dt
        }
      }
      prevAltRef.current = currentAlt

      if (hasStartRate) {
        // Vorausschauender Start: Countdown so timen, dass bei 0 die Starthöhe erreicht wird
        const rateFtPerSec = currentVarioRef.current / 60 // ft/sec
        const sameDirection = (currentVarioRef.current > 0) === (profileStartRateFtMin > 0)
        const minRate = Math.abs(currentVarioRef.current) >= Math.abs(profileStartRateFtMin) * 0.3
        if (!sameDirection || !minRate) return

        // Wie viele Sekunden bis Starthöhe bei aktueller Rate?
        const altToGo = startAlt - currentAlt // positiv = muss noch steigen, negativ = muss sinken
        const secsToTarget = Math.abs(rateFtPerSec) > 0.1 ? altToGo / rateFtPerSec : Infinity

        // Countdown starten wenn wir in ~3 Sekunden die Starthöhe erreichen
        if (secsToTarget >= 2.5 && secsToTarget <= 3.5) {
          if (alignIntervalRef.current) {
            clearInterval(alignIntervalRef.current)
            alignIntervalRef.current = null
          }
          setPhase('countdown')
          setCountdown(3)
        }
      } else {
        // Kein Start-Rate: wie bisher - Höhe muss innerhalb Toleranz sein
        if (Math.abs(dev) <= tolerance) {
          if (alignIntervalRef.current) {
            clearInterval(alignIntervalRef.current)
            alignIntervalRef.current = null
          }
          setPhase('countdown')
          setCountdown(3)
        }
      }
    }, 200)

    return () => {
      if (alignIntervalRef.current) {
        clearInterval(alignIntervalRef.current)
        alignIntervalRef.current = null
      }
    }
  }, [phase, profilePoints, layerAFt, getCurrentAltFt, hasStartRate, profileStartRateFtMin])

  // Countdown: 3 → 2 → 1 → GO!
  useEffect(() => {
    if (phase !== 'countdown') {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
        countdownRef.current = null
      }
      return
    }

    countdownRef.current = window.setInterval(() => {
      const currentAlt = getCurrentAltFt()
      const altDelta = currentAlt - prevAltRef.current
      currentVarioRef.current = altDelta * (60000 / 1000)
      prevAltRef.current = currentAlt

      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current)
            countdownRef.current = null
          }
          setHistory([])
          setTaskStartTime(Date.now())
          setIsRunning(true)
          setIsPaused(false)
          setElapsedMinutes(0)
          setPhase('live')
          return 0
        }

        const startAlt = profilePoints[0]?.altitudeFt ?? 0

        if (hasStartRate) {
          // Bei Startrate: Prüfe ob vorhergesagte Höhe bei Countdown=0 noch stimmt
          const rateFtPerSec = currentVarioRef.current / 60
          const secsRemaining = prev - 1 // Sekunden bis GO nach diesem Tick
          const predictedAlt = currentAlt + rateFtPerSec * secsRemaining
          const predictedDev = Math.abs(predictedAlt - startAlt)

          // Rate-Richtung muss stimmen und vorhergesagte Abweichung < Toleranz
          const sameDirection = (currentVarioRef.current > 0) === (profileStartRateFtMin > 0)
          if (!sameDirection || predictedDev > layerAFt) {
            if (countdownRef.current) {
              clearInterval(countdownRef.current)
              countdownRef.current = null
            }
            setPhase('aligning')
            return 3
          }
        } else {
          // Ohne Startrate: Höhe muss innerhalb Toleranz bleiben
          if (Math.abs(currentAlt - startAlt) > layerAFt) {
            if (countdownRef.current) {
              clearInterval(countdownRef.current)
              countdownRef.current = null
            }
            setPhase('aligning')
            return 3
          }
        }

        return prev - 1
      })
    }, 1000)

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
        countdownRef.current = null
      }
    }
  }, [phase, profilePoints, layerAFt, getCurrentAltFt, hasStartRate, profileStartRateFtMin])

  // Live-Update Loop
  useEffect(() => {
    if (!isRunning || !taskStartTime || isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    intervalRef.current = window.setInterval(() => {
      const now = Date.now()
      const elapsed = (now - taskStartTime) / 60000
      setElapsedMinutes(elapsed)

      if (elapsed >= totalDuration) {
        setIsRunning(false)
        setPhase('finished')
        return
      }

      const targetAlt = interpolateProfile(elapsed, profilePoints)
      if (targetAlt === null) return

      const currentAlt = getCurrentAltFt()
      const deviation = currentAlt - targetAlt
      const absDeviation = Math.abs(deviation)

      let layer: 'A' | 'B' | 'outside' = 'outside'
      if (absDeviation <= layerAFt) layer = 'A'
      else if (absDeviation <= layerBFt) layer = 'B'

      setCurrentDeviation(deviation)
      setCurrentLayer(layer)

      // Vorausschauende Ziel-Rate
      let nextLookahead: typeof lookahead = null

      const LOOKAHEAD_SEC = 15
      const lookaheadMin = LOOKAHEAD_SEC / 60

      const futureTime = Math.min(elapsed + lookaheadMin, totalDuration)
      const futureTargetAlt = interpolateProfile(futureTime, profilePoints)
      const currentTargetAlt = interpolateProfile(elapsed, profilePoints)

      if (futureTargetAlt !== null && currentTargetAlt !== null) {
        const altDiff = futureTargetAlt - currentAlt
        const rateFtMin = altDiff / lookaheadMin

        const absRate = Math.abs(rateFtMin)

        let upcoming: { action: 'STEIGEN' | 'SINKEN' | 'HALTEN'; inSeconds: number; rateFtMin: number } | undefined = undefined

        let currSegIdx = -1
        for (let pi = 0; pi < profilePoints.length - 1; pi++) {
          if (elapsed >= profilePoints[pi].timeMinutes && elapsed < profilePoints[pi + 1].timeMinutes) {
            currSegIdx = pi
            break
          }
        }

        if (currSegIdx >= 0) {
          const currP1 = profilePoints[currSegIdx]
          const currP2 = profilePoints[currSegIdx + 1]
          const currChange = currP2.altitudeFt - currP1.altitudeFt
          const currDur = currP2.timeMinutes - currP1.timeMinutes
          const currType: 'STEIGEN' | 'SINKEN' | 'HALTEN' =
            currDur <= 0 || Math.abs(currChange) < 20 ? 'HALTEN'
            : currChange > 0 ? 'STEIGEN' : 'SINKEN'

          for (let pi = currSegIdx + 1; pi < profilePoints.length - 1; pi++) {
            const p1 = profilePoints[pi]
            const p2 = profilePoints[pi + 1]
            const segChange = p2.altitudeFt - p1.altitudeFt
            const segDur = p2.timeMinutes - p1.timeMinutes
            if (segDur <= 0) continue

            const segType: 'STEIGEN' | 'SINKEN' | 'HALTEN' =
              Math.abs(segChange) < 20 ? 'HALTEN'
              : segChange > 0 ? 'STEIGEN' : 'SINKEN'

            if (segType === currType) continue

            const secsUntil = (p1.timeMinutes - elapsed) * 60
            const segRateFtMin = segDur > 0 ? Math.abs(segChange) / segDur : 0

            if (secsUntil > 0 && secsUntil <= 90) {
              upcoming = {
                action: segType,
                inSeconds: Math.round(secsUntil),
                rateFtMin: segRateFtMin,
              }
            }
            break
          }
        }

        if (absRate > 5) {
          nextLookahead = {
            action: rateFtMin > 0 ? 'STEIGEN' : 'SINKEN',
            inMinutes: 0,
            targetAltFt: futureTargetAlt,
            altChangeFt: Math.abs(altDiff),
            requiredRateFtMin: Math.round(absRate),
            timeAvailableMin: lookaheadMin,
            upcoming,
          }
        } else if (upcoming) {
          nextLookahead = {
            action: upcoming.action === 'HALTEN' ? 'HALTEN' : upcoming.action,
            inMinutes: upcoming.inSeconds / 60,
            targetAltFt: futureTargetAlt,
            altChangeFt: 0,
            requiredRateFtMin: Math.round(upcoming.rateFtMin),
            timeAvailableMin: 0,
            upcoming,
          }
        }
      }

      setLookahead(nextLookahead)

      setHistory(prev => {
        const newPoint: HistoryPoint = {
          timeMinutes: elapsed,
          actualFt: currentAlt,
          targetFt: targetAlt,
          layer
        }
        if (prev.length > 0) {
          const last = prev[prev.length - 1]
          if (elapsed - last.timeMinutes < 1 / 60) return prev
        }
        return [...prev, newPoint]
      })
    }, 500)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isRunning, taskStartTime, isPaused, profilePoints, totalDuration, layerAFt, layerBFt, getCurrentAltFt])

  // Task starten
  const handleStart = () => {
    if (profilePoints.length < 2) return
    const startAlt = profilePoints[0].altitudeFt
    const currentAlt = getCurrentAltFt()
    const dev = Math.abs(currentAlt - startAlt)

    if (dev <= layerAFt && !hasStartRate) {
      setPhase('countdown')
      setCountdown(3)
    } else {
      setAlignDeviation(currentAlt - startAlt)
      setPhase('aligning')
    }
  }

  const handleStop = () => {
    setIsRunning(false)
    setIsPaused(false)
    setPhase('finished')
  }

  // APT Profil speichern
  const handleOpenSaveDialog = async () => {
    setShowSaveDialog(true)
    setSaveSuccess(null)
    setLoadingChamps(true)

    const user = useAuthStore.getState().user
    if (!user) {
      setChampionships([])
      setLoadingChamps(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('championships')
        .select('id, name')
        .eq('user_id', user.id)
        .eq('archived', false)
        .order('created_at', { ascending: false })

      if (!error && data) {
        setChampionships(data)
        const active = useFlightStore.getState().activeChampionship
        if (active && data.some(c => c.id === active.id)) {
          setSelectedChampId(active.id)
        } else if (data.length > 0) {
          setSelectedChampId(data[0].id)
        }
      }
    } catch {
      setChampionships([])
    }
    setLoadingChamps(false)
  }

  const handleSaveToChampionship = async () => {
    if (!selectedChampId || history.length === 0) return
    setSaving(true)
    setSaveSuccess(null)

    const now = new Date()
    const taskName = activeTask?.taskNumber ? `Task ${activeTask.taskNumber}` : 'APT'
    const profileName = `${taskName} Profil ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`

    const layerACnt = history.filter(h => h.layer === 'A').length
    const layerBCnt = history.filter(h => h.layer === 'B').length
    const outsideCnt = history.filter(h => h.layer === 'outside').length
    const total = history.length || 1

    const aptData = {
      type: 'apt_profile' as const,
      profilePoints,
      layerAFt,
      layerBFt,
      history,
      totalDuration,
      taskName,
      stats: {
        layerAPercent: Math.round((layerACnt / total) * 100),
        layerBPercent: Math.round((layerBCnt / total) * 100),
        outsidePercent: Math.round((outsideCnt / total) * 100),
      },
      savedAt: now.toISOString()
    }

    try {
      const { error } = await supabase.from('championship_flights')
        .insert({
          championship_id: selectedChampId,
          name: profileName,
          flight_data: aptData
        })

      if (error) {
        setSaveSuccess('Fehler: ' + error.message)
      } else {
        const champName = championships.find(c => c.id === selectedChampId)?.name || ''
        setSaveSuccess(`Gespeichert in "${champName}"`)
        setShowSaveDialog(false)
      }
    } catch {
      setSaveSuccess('Verbindungsfehler')
    }
    setSaving(false)
  }

  // Profil-Punkt Aktionen
  const addPoint = () => {
    const lastTime = profilePoints.length > 0 ? profilePoints[profilePoints.length - 1].timeMinutes : 0
    const lastAlt = profilePoints.length > 0 ? profilePoints[profilePoints.length - 1].altitudeFt : 2500
    setProfilePoints([...profilePoints, { timeMinutes: lastTime + 1, altitudeFt: lastAlt }])
  }

  const removePoint = (index: number) => {
    if (index === 0 || profilePoints.length <= 2) return
    setProfilePoints(profilePoints.filter((_, i) => i !== index))
  }

  const updatePoint = (index: number, field: 'timeMinutes' | 'altitudeFt', value: number) => {
    if (index === 0 && field === 'timeMinutes') return
    const updated = [...profilePoints]
    updated[index] = { ...updated[index], [field]: value }
    if (field === 'timeMinutes') {
      updated.sort((a, b) => a.timeMinutes - b.timeMinutes)
    }
    setProfilePoints(updated)
  }

  // ═══ SVG Rendering ═══
  const SVG_WIDTH = 420
  const SVG_HEIGHT = 220
  const PADDING = { top: 15, right: 15, bottom: 25, left: 45 }
  const chartW = SVG_WIDTH - PADDING.left - PADDING.right
  const chartH = SVG_HEIGHT - PADDING.top - PADDING.bottom

  const allAltitudes = [
    ...profilePoints.map(p => p.altitudeFt + layerBFt),
    ...profilePoints.map(p => p.altitudeFt - layerBFt),
    ...history.map(h => h.actualFt),
  ]
  const minAlt = allAltitudes.length > 0 ? Math.min(...allAltitudes) - 50 : 1500
  const maxAlt = allAltitudes.length > 0 ? Math.max(...allAltitudes) + 50 : 3500
  const altRange = maxAlt - minAlt || 1

  const svgX = (timeMin: number) => PADDING.left + (timeMin / totalDuration) * chartW
  const svgY = (altFt: number) => PADDING.top + chartH - ((altFt - minAlt) / altRange) * chartH

  const layerBPoints = (() => {
    if (profilePoints.length < 2) return ''
    const steps = 50
    const upper: string[] = []
    const lower: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalDuration
      const alt = interpolateProfile(t, profilePoints)
      if (alt === null) continue
      upper.push(`${svgX(t)},${svgY(alt + layerBFt)}`)
      lower.unshift(`${svgX(t)},${svgY(alt - layerBFt)}`)
    }
    return [...upper, ...lower].join(' ')
  })()

  const layerAPoints = (() => {
    if (profilePoints.length < 2) return ''
    const steps = 50
    const upper: string[] = []
    const lower: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalDuration
      const alt = interpolateProfile(t, profilePoints)
      if (alt === null) continue
      upper.push(`${svgX(t)},${svgY(alt + layerAFt)}`)
      lower.unshift(`${svgX(t)},${svgY(alt - layerAFt)}`)
    }
    return [...upper, ...lower].join(' ')
  })()

  const profileLine = profilePoints.map(p => `${svgX(p.timeMinutes)},${svgY(p.altitudeFt)}`).join(' ')

  const renderPilotTrack = () => {
    if (history.length < 2) return null
    const segments: { points: string; color: string }[] = []
    let currentSegmentLayer = history[0].layer
    let currentSegmentPoints = [`${svgX(history[0].timeMinutes)},${svgY(history[0].actualFt)}`]

    for (let i = 1; i < history.length; i++) {
      const h = history[i]
      const ptStr = `${svgX(h.timeMinutes)},${svgY(h.actualFt)}`

      if (h.layer !== currentSegmentLayer) {
        currentSegmentPoints.push(ptStr)
        segments.push({
          points: currentSegmentPoints.join(' '),
          color: currentSegmentLayer === 'A' ? '#22c55e' : currentSegmentLayer === 'B' ? '#eab308' : '#ef4444'
        })
        currentSegmentLayer = h.layer
        currentSegmentPoints = [ptStr]
      } else {
        currentSegmentPoints.push(ptStr)
      }
    }
    if (currentSegmentPoints.length > 1) {
      segments.push({
        points: currentSegmentPoints.join(' '),
        color: currentSegmentLayer === 'A' ? '#22c55e' : currentSegmentLayer === 'B' ? '#eab308' : '#ef4444'
      })
    }

    return segments.map((seg, i) => (
      <polyline
        key={i}
        points={seg.points}
        fill="none"
        stroke={seg.color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))
  }

  const renderGrid = () => {
    const lines: React.ReactNode[] = []
    const altStep = altRange > 800 ? 200 : 100
    const startAltGrid = Math.ceil(minAlt / altStep) * altStep
    for (let alt = startAltGrid; alt <= maxAlt; alt += altStep) {
      const y = svgY(alt)
      lines.push(
        <line key={`h-${alt}`} x1={PADDING.left} y1={y} x2={SVG_WIDTH - PADDING.right} y2={y}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" />,
        <text key={`ht-${alt}`} x={PADDING.left - 5} y={y + 3} fill="rgba(255,255,255,0.35)"
          fontSize="9" textAnchor="end">{alt}</text>
      )
    }
    const timeStep = totalDuration > 10 ? 2 : 1
    for (let t = 0; t <= totalDuration; t += timeStep) {
      const x = svgX(t)
      lines.push(
        <line key={`v-${t}`} x1={x} y1={PADDING.top} x2={x} y2={SVG_HEIGHT - PADDING.bottom}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" />,
        <text key={`vt-${t}`} x={x} y={SVG_HEIGHT - PADDING.bottom + 14} fill="rgba(255,255,255,0.35)"
          fontSize="9" textAnchor="middle">{t}m</text>
      )
    }
    return lines
  }

  const deviationColor = currentLayer === 'A' ? '#22c55e' : currentLayer === 'B' ? '#eab308' : '#ef4444'

  const formatTime = (minutes: number) => {
    const m = Math.floor(minutes)
    const s = Math.floor((minutes - m) * 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Farben für Steigen/Sinken/Halten
  const climbColor = '#22c55e'
  const sinkColor = '#ef4444'
  const holdColor = '#3b82f6'
  const actionColor = (a: 'STEIGEN' | 'SINKEN' | 'HALTEN') =>
    a === 'STEIGEN' ? climbColor : a === 'SINKEN' ? sinkColor : holdColor
  const actionIcon = (a: 'STEIGEN' | 'SINKEN' | 'HALTEN') =>
    a === 'STEIGEN' ? '▲' : a === 'SINKEN' ? '▼' : '═'
  const actionSign = (a: 'STEIGEN' | 'SINKEN' | 'HALTEN') =>
    a === 'STEIGEN' ? '+' : a === 'SINKEN' ? '-' : ''

  const aptScale = settings.aptPanelScale ?? 1

  // Gemeinsame Button-Styles
  const btnBase: React.CSSProperties = {
    borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    border: 'none', padding: '10px 16px', transition: 'opacity 0.15s'
  }
  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
    color: '#fff',
  }
  const btnDanger: React.CSSProperties = {
    ...btnBase,
    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
    color: '#fff',
  }
  const btnGhost: React.CSSProperties = {
    ...btnBase,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.6)',
  }

  return (
    <div
      onMouseDown={handleAptMouseDown}
      onTouchStart={handleAptTouchStart}
      style={{
        position: 'fixed',
        ...(aptPanelPos
          ? { left: aptPanelPos.x, top: aptPanelPos.y }
          : { left: '50%', top: '50%' }
        ),
        width: '460px',
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.1)',
        padding: '16px',
        zIndex: 2000,
        backdropFilter: 'none',
        color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        transform: `translate(-50%, -50%) scale(${aptScale})`,
        transformOrigin: 'center center',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        cursor: isAptDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '12px', paddingBottom: '10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '13px', fontWeight: 700, color: '#22c55e',
            background: 'rgba(34,197,94,0.12)', padding: '3px 8px', borderRadius: '6px',
          }}>APT</span>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Altitude Profile Task</span>
          {isRunning && (
            <span style={{
              fontSize: '10px', fontWeight: 600, color: '#22c55e',
              background: 'rgba(34,197,94,0.15)', padding: '2px 8px', borderRadius: '10px',
              animation: 'pulse 2s ease-in-out infinite',
            }}>LIVE</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {isRunning && (
            <button
              onClick={() => setIsPaused(!isPaused)}
              style={{
                ...btnGhost,
                padding: '4px 10px', fontSize: '10px',
                color: isPaused ? '#eab308' : 'rgba(255,255,255,0.5)',
                border: isPaused ? '1px solid rgba(234,179,8,0.3)' : '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {isPaused ? 'RESUME' : 'PAUSE'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px', color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer', fontSize: '14px', padding: '2px 8px', lineHeight: 1,
            }}
          >
            x
          </button>
        </div>
      </div>

      {/* ═══ Alignment-Phase ═══ */}
      {(phase === 'aligning' || phase === 'countdown') && (
        <div>
          {/* Preview SVG */}
          {profilePoints.length >= 2 && (
            <svg width={SVG_WIDTH} height={SVG_HEIGHT} style={{
              background: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '10px',
              display: 'block',
            }}>
              {renderGrid()}
              {layerBPoints && <polygon points={layerBPoints} fill="rgba(34,197,94,0.04)" stroke="none" />}
              {layerAPoints && <polygon points={layerAPoints} fill="rgba(34,197,94,0.08)" stroke="none" />}
              <polyline points={profileLine} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4,2" />
              <line
                x1={PADDING.left} y1={svgY(profilePoints[0].altitudeFt)}
                x2={SVG_WIDTH - PADDING.right} y2={svgY(profilePoints[0].altitudeFt)}
                stroke="rgba(34,197,94,0.5)" strokeWidth="1.5" strokeDasharray="6,3"
              />
              <line
                x1={PADDING.left} y1={svgY(getCurrentAltFt())}
                x2={SVG_WIDTH - PADDING.right} y2={svgY(getCurrentAltFt())}
                stroke={phase === 'countdown' ? '#22c55e' : '#eab308'} strokeWidth="1.5"
              />
              <circle
                cx={PADDING.left + 10}
                cy={svgY(getCurrentAltFt())}
                r="5"
                fill={phase === 'countdown' ? '#22c55e' : '#eab308'}
                stroke="#fff" strokeWidth="1.5"
              />
            </svg>
          )}

          {phase === 'countdown' ? (
            <div style={{ textAlign: 'center', padding: '16px 12px' }}>
              <div style={{
                fontSize: '11px', color: '#22c55e', marginBottom: '10px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '1px',
              }}>
                {hasStartRate ? 'Hoehe + Rate OK' : 'Hoehe erreicht'} - Task startet in
              </div>
              <div style={{
                fontSize: '72px', fontWeight: 700, color: countdown <= 1 ? '#22c55e' : '#fff',
                lineHeight: 1,
                textShadow: countdown <= 1 ? '0 0 30px rgba(34,197,94,0.5)' : 'none',
              }}>
                {countdown}
              </div>
              {hasStartRate && (
                <div style={{
                  fontSize: '14px', color: climbColor, marginTop: '10px', fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  background: 'rgba(34,197,94,0.1)', padding: '6px 14px', borderRadius: '8px',
                }}>
                  {profileStartRateFtMin > 0 ? '▲' : '▼'}{' '}
                  {profileStartRateFtMin > 0 ? '+' : '-'}
                  {isMetric
                    ? rateToDisplay(Math.abs(profileStartRateFtMin)).toFixed(1) + ' m/s'
                    : Math.round(Math.abs(profileStartRateFtMin)) + ' ft/min'
                  }
                </div>
              )}
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '8px' }}>
                {hasStartRate
                  ? 'Hoehe + Rate halten! Bei Abweichung wird der Countdown zurueckgesetzt.'
                  : 'Hoehe halten! Bei Abweichung wird der Countdown zurueckgesetzt.'
                }
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px' }}>
              {(() => {
                const startAlt = profilePoints[0]?.altitudeFt ?? 0
                const currentAlt = getCurrentAltFt()
                const dev = alignDeviation
                const needsClimb = dev < 0
                const absDev = Math.abs(dev)

                return (
                  <>
                    <div style={{
                      fontSize: '13px', fontWeight: 700,
                      color: needsClimb ? climbColor : sinkColor,
                      marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      {needsClimb ? '▲ Steigen auf Starthoehe' : '▼ Sinken auf Starthoehe'}
                    </div>

                    <div style={{
                      display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '12px',
                      fontSize: '12px', color: 'rgba(255,255,255,0.5)',
                    }}>
                      <span>IST: <b style={{ color: '#fff', fontSize: '14px' }}>{Math.round(currentAlt)} ft</b></span>
                      <span>SOLL: <b style={{ color: '#22c55e', fontSize: '14px' }}>{Math.round(startAlt)} ft</b></span>
                    </div>

                    <div style={{
                      fontSize: '40px', fontWeight: 700,
                      color: needsClimb ? climbColor : sinkColor,
                      fontVariantNumeric: 'tabular-nums',
                      lineHeight: 1,
                      marginBottom: '8px',
                    }}>
                      {needsClimb ? '+' : '-'}{Math.round(absDev)} ft
                    </div>

                    {hasStartRate && (
                      <div style={{
                        marginTop: '8px', padding: '10px 14px',
                        background: needsClimb ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                        border: `1px solid ${needsClimb ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        borderRadius: '8px',
                      }}>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Startrate (Profil beginnt {profileStartRateFtMin > 0 ? 'steigend' : 'sinkend'})
                        </div>
                        <div style={{
                          fontSize: '24px', fontWeight: 700,
                          color: profileStartRateFtMin > 0 ? climbColor : sinkColor,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {profileStartRateFtMin > 0 ? '+' : '-'}
                          {isMetric
                            ? rateToDisplay(Math.abs(profileStartRateFtMin)).toFixed(1)
                            : Math.round(Math.abs(profileStartRateFtMin))
                          }
                          <span style={{ fontSize: '12px', marginLeft: '4px', color: 'rgba(255,255,255,0.4)' }}>
                            {rateUnit}
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                          Bei Starthoehe mit dieser Rate {profileStartRateFtMin > 0 ? 'steigen' : 'sinken'} - Countdown startet automatisch
                        </div>
                      </div>
                    )}

                    {!hasStartRate && (
                      <div style={{
                        fontSize: '10px', color: 'rgba(255,255,255,0.3)',
                        padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px',
                      }}>
                        Profil beginnt level - auf +/-{layerAFt} ft genau ausrichten
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          <button
            onClick={() => setPhase('setup')}
            style={{ ...btnGhost, width: '100%', marginTop: '8px' }}
          >
            ABBRECHEN
          </button>
        </div>
      )}

      {/* ═══ Setup-Modus ═══ */}
      {phase === 'setup' && (
        <div>
          {activeTask?.aptProfile?.isDefault && (
            <div style={{
              background: 'rgba(234,179,8,0.08)',
              border: '1px solid rgba(234,179,8,0.2)',
              borderRadius: '8px',
              padding: '8px 12px',
              marginBottom: '10px',
              fontSize: '11px',
              color: '#eab308',
              lineHeight: 1.5
            }}>
              Profil aus Tasksheet-Diagramm ablesen und unten eintragen.
              Layer A (+/-{layerAFt}ft) und B (+/-{layerBFt}ft) wurden uebernommen.
            </div>
          )}

          {/* Profil-Punkte */}
          <div style={{
            fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px',
            textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600,
          }}>
            Profil-Punkte
          </div>
          <div style={{
            maxHeight: '160px', overflowY: 'auto', marginBottom: '8px',
            background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '6px',
          }}>
            {profilePoints.map((point, i) => (
              <div key={i} style={{
                display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px'
              }}>
                {i === 0 ? (
                  <>
                    <span style={{
                      width: '50px', fontSize: '11px', color: '#22c55e', fontWeight: 600,
                      textAlign: 'center', display: 'inline-block'
                    }}>START</span>
                    <span style={{ width: '22px' }}></span>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      value={point.timeMinutes}
                      onChange={(e) => updatePoint(i, 'timeMinutes', parseFloat(e.target.value) || 0)}
                      step={0.5}
                      style={{
                        width: '50px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '6px', color: '#fff', padding: '5px 6px', fontSize: '12px', textAlign: 'right',
                        outline: 'none',
                      }}
                    />
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>min</span>
                  </>
                )}
                <input
                  type="number"
                  value={point.altitudeFt}
                  onChange={(e) => updatePoint(i, 'altitudeFt', parseFloat(e.target.value) || 0)}
                  step={50}
                  style={{
                    width: '70px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '6px', color: '#fff', padding: '5px 6px', fontSize: '12px', textAlign: 'right',
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>ft</span>
                {i > 0 && profilePoints.length > 2 && (
                  <button
                    onClick={() => removePoint(i)}
                    style={{
                      background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '4px',
                      color: 'rgba(239,68,68,0.6)', cursor: 'pointer', fontSize: '12px',
                      padding: '2px 6px', lineHeight: 1,
                    }}
                  >x</button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addPoint}
            style={{
              ...btnGhost, width: '100%', padding: '6px', marginBottom: '12px',
              fontSize: '11px',
            }}
          >
            + Punkt hinzufuegen
          </button>

          {/* Layer-Konfiguration */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', fontWeight: 600 }}>LAYER A (+/-ft)</div>
              <input
                type="number"
                value={layerAFt}
                onChange={(e) => setLayerAFt(parseFloat(e.target.value) || 50)}
                step={10}
                style={{
                  width: '100%', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: '6px', color: '#22c55e', padding: '6px 8px', fontSize: '13px', textAlign: 'center',
                  outline: 'none', fontWeight: 600,
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', fontWeight: 600 }}>LAYER B (+/-ft)</div>
              <input
                type="number"
                value={layerBFt}
                onChange={(e) => setLayerBFt(parseFloat(e.target.value) || 100)}
                step={10}
                style={{
                  width: '100%', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)',
                  borderRadius: '6px', color: '#eab308', padding: '6px 8px', fontSize: '13px', textAlign: 'center',
                  outline: 'none', fontWeight: 600,
                }}
              />
            </div>
          </div>

          {/* Preview SVG */}
          {profilePoints.length >= 2 && (
            <svg width={SVG_WIDTH} height={SVG_HEIGHT} style={{
              background: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '12px',
              display: 'block',
            }}>
              {renderGrid()}
              {layerBPoints && <polygon points={layerBPoints} fill="rgba(234,179,8,0.04)" stroke="none" />}
              {layerAPoints && <polygon points={layerAPoints} fill="rgba(34,197,94,0.06)" stroke="none" />}
              <polyline points={profileLine} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
              {profilePoints.map((p, i) => (
                <circle key={i} cx={svgX(p.timeMinutes)} cy={svgY(p.altitudeFt)} r="3.5" fill="#22c55e" stroke="#0f172a" strokeWidth="1.5" />
              ))}
            </svg>
          )}

          {/* Start Button */}
          <button
            onClick={handleStart}
            disabled={profilePoints.length < 2}
            style={{
              ...btnPrimary,
              width: '100%', letterSpacing: '1px', fontSize: '13px',
              opacity: profilePoints.length >= 2 ? 1 : 0.3,
              cursor: profilePoints.length >= 2 ? 'pointer' : 'default',
            }}
          >
            START APT
          </button>
        </div>
      )}

      {/* ═══ Live-Modus ═══ */}
      {(phase === 'live' || phase === 'finished') && (
        <div>
          {/* Live SVG Chart */}
          <svg width={SVG_WIDTH} height={SVG_HEIGHT} style={{
            background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
            display: 'block',
          }}>
            {renderGrid()}
            {layerBPoints && <polygon points={layerBPoints} fill="rgba(234,179,8,0.04)" stroke="none" />}
            {layerAPoints && <polygon points={layerAPoints} fill="rgba(34,197,94,0.06)" stroke="none" />}
            <polyline points={profileLine} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4,2" />
            {renderPilotTrack()}
            {isRunning && elapsedMinutes <= totalDuration && (
              <>
                <line
                  x1={svgX(elapsedMinutes)} y1={PADDING.top}
                  x2={svgX(elapsedMinutes)} y2={SVG_HEIGHT - PADDING.bottom}
                  stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2,2"
                />
                <circle
                  cx={svgX(elapsedMinutes)}
                  cy={svgY(getCurrentAltFt())}
                  r="5"
                  fill={deviationColor}
                  stroke="#fff"
                  strokeWidth="1.5"
                />
                {(() => {
                  const target = interpolateProfile(elapsedMinutes, profilePoints)
                  if (target === null) return null
                  return (
                    <circle
                      cx={svgX(elapsedMinutes)}
                      cy={svgY(target)}
                      r="3"
                      fill="none"
                      stroke="rgba(255,255,255,0.4)"
                      strokeWidth="1"
                    />
                  )
                })()}
              </>
            )}
          </svg>

          {/* Live Info Bar */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px', marginTop: '10px',
          }}>
            {/* Abweichung */}
            <div style={{
              background: `${deviationColor}0d`, borderRadius: '8px',
              border: `1px solid ${deviationColor}25`,
              padding: '8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Abweichung</div>
              <div style={{
                fontSize: '22px', fontWeight: 700, color: deviationColor,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
              }}>
                {isRunning ? (
                  <>
                    {currentDeviation > 0 ? '+' : ''}{Math.round(currentDeviation)}
                    <span style={{ fontSize: '11px', marginLeft: '2px' }}>ft</span>
                  </>
                ) : '-'}
              </div>
            </div>

            {/* Layer + Rate */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Layer</div>
              <div style={{
                fontSize: '18px', fontWeight: 700, color: deviationColor,
                lineHeight: 1.1,
              }}>
                {isRunning ? (currentLayer === 'outside' ? 'OUT' : currentLayer) : '-'}
              </div>
              {isRunning && (
                lookahead ? (
                  lookahead.inMinutes <= 0 ? (
                    <div style={{ marginTop: '3px' }}>
                      <div style={{
                        fontSize: '12px', fontWeight: 700,
                        color: actionColor(lookahead.action),
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {lookahead.action === 'HALTEN' ? '= halten' : (
                          <>
                            {actionIcon(lookahead.action)}{' '}{actionSign(lookahead.action)}
                            {isMetric
                              ? rateToDisplay(lookahead.requiredRateFtMin).toFixed(1)
                              : Math.round(lookahead.requiredRateFtMin)
                            }
                            <span style={{ fontSize: '9px', marginLeft: '2px' }}>{rateUnit}</span>
                          </>
                        )}
                      </div>
                      {lookahead.upcoming && (
                        <div style={{
                          marginTop: '2px', fontSize: '9px', fontWeight: 600,
                          color: actionColor(lookahead.upcoming.action),
                          fontVariantNumeric: 'tabular-nums',
                          opacity: 0.8,
                        }}>
                          {lookahead.upcoming.action === 'HALTEN' ? '= halten' : (
                            <>
                              {actionIcon(lookahead.upcoming.action)}{' '}{actionSign(lookahead.upcoming.action)}
                              {isMetric
                                ? rateToDisplay(lookahead.upcoming.rateFtMin).toFixed(1)
                                : Math.round(lookahead.upcoming.rateFtMin)
                              }
                              <span style={{ marginLeft: '2px' }}>{rateUnit}</span>
                            </>
                          )}
                          <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: '3px' }}>
                            in {lookahead.upcoming.inSeconds}s
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      marginTop: '3px', fontSize: '10px', fontWeight: 700,
                      color: actionColor(lookahead.action),
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {lookahead.action === 'HALTEN' ? '= halten' : (
                        <>
                          {actionIcon(lookahead.action)}{' '}{actionSign(lookahead.action)}
                          {isMetric
                            ? rateToDisplay(lookahead.requiredRateFtMin).toFixed(1)
                            : Math.round(lookahead.requiredRateFtMin)
                          }
                          <span style={{ marginLeft: '2px' }}>{rateUnit}</span>
                        </>
                      )}
                      <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', marginLeft: '3px' }}>
                        in {lookahead.upcoming ? `${lookahead.upcoming.inSeconds}s` : formatTime(lookahead.inMinutes)}
                      </span>
                    </div>
                  )
                ) : (
                  <div style={{
                    marginTop: '3px', fontSize: '10px', fontWeight: 600,
                    color: holdColor,
                  }}>
                    = Hoehe halten
                  </div>
                )
              )}
            </div>

            {/* Zeit */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Zeit</div>
              <div style={{
                fontSize: '18px', fontWeight: 700, color: '#fff',
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
              }}>
                {formatTime(elapsedMinutes)}
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                / {formatTime(totalDuration)}
              </div>
            </div>
          </div>

          {/* IST/SOLL Zeile */}
          {isRunning && (
            <div style={{
              display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '8px',
              fontSize: '11px', color: 'rgba(255,255,255,0.4)',
              padding: '6px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px',
            }}>
              <span>IST: <b style={{ color: '#fff', fontSize: '13px' }}>{Math.round(getCurrentAltFt())} ft</b></span>
              <span>SOLL: <b style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
                {Math.round(interpolateProfile(elapsedMinutes, profilePoints) ?? 0)} ft
              </b></span>
            </div>
          )}

          {/* Ergebnis (finished) */}
          {phase === 'finished' && history.length > 0 && (
            <div style={{
              marginTop: '10px', padding: '12px',
              background: 'rgba(0,0,0,0.15)',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {(() => {
                const layerACnt = history.filter(h => h.layer === 'A').length
                const layerBCnt = history.filter(h => h.layer === 'B').length
                const outsideCnt = history.filter(h => h.layer === 'outside').length
                const total = history.length || 1
                return (
                  <div style={{
                    display: 'flex', justifyContent: 'space-around', marginBottom: '10px',
                    fontSize: '12px',
                  }}>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>
                      A: {Math.round((layerACnt / total) * 100)}%
                    </span>
                    <span style={{ color: '#eab308', fontWeight: 600 }}>
                      B: {Math.round((layerBCnt / total) * 100)}%
                    </span>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>
                      Out: {Math.round((outsideCnt / total) * 100)}%
                    </span>
                  </div>
                )
              })()}

              {!showSaveDialog ? (
                <button
                  onClick={handleOpenSaveDialog}
                  style={{ ...btnPrimary, width: '100%', fontSize: '12px' }}
                >
                  Speichern
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600, marginBottom: '6px' }}>
                    Meisterschaft waehlen
                  </div>
                  {loadingChamps ? (
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '8px' }}>
                      Laden...
                    </div>
                  ) : championships.length === 0 ? (
                    <div style={{ fontSize: '11px', color: '#ef4444', textAlign: 'center', padding: '8px' }}>
                      Keine Meisterschaften vorhanden
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedChampId}
                        onChange={(e) => setSelectedChampId(e.target.value)}
                        style={{
                          width: '100%', padding: '8px 10px', marginBottom: '8px',
                          background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '6px', color: '#fff', fontSize: '12px', outline: 'none',
                        }}
                      >
                        {championships.map(c => (
                          <option key={c.id} value={c.id} style={{ background: '#1e293b' }}>{c.name}</option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setShowSaveDialog(false)} style={{ ...btnGhost, flex: 1, fontSize: '11px' }}>
                          Abbrechen
                        </button>
                        <button
                          onClick={handleSaveToChampionship}
                          disabled={saving || !selectedChampId}
                          style={{ ...btnPrimary, flex: 1, fontSize: '11px', opacity: saving ? 0.6 : 1 }}
                        >
                          {saving ? 'Speichern...' : 'Speichern'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {saveSuccess && (
                <div style={{
                  marginTop: '6px', fontSize: '10px', textAlign: 'center',
                  color: saveSuccess.includes('Fehler') || saveSuccess.includes('fehler') ? '#ef4444' : '#22c55e',
                }}>
                  {saveSuccess}
                </div>
              )}
            </div>
          )}

          {/* Stop / Reset Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            {isRunning ? (
              <button onClick={handleStop} style={{ ...btnDanger, flex: 1, letterSpacing: '1px' }}>
                STOP
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setTaskStartTime(null); setHistory([]); setPhase('setup') }}
                  style={{ ...btnGhost, flex: 1 }}
                >
                  SETUP
                </button>
                <button
                  onClick={handleStart}
                  style={{ ...btnPrimary, flex: 1, letterSpacing: '1px' }}
                >
                  RESTART
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
