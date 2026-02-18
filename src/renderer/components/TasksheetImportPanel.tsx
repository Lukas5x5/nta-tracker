import React, { useState, useRef, useEffect } from 'react'
import { useFlightStore } from '../stores/flightStore'
import {
  parseTasksheetText,
  ParsedTask,
  TasksheetParseResult,
  expandUTMCoordinates,
  formatTime,
  TASK_TYPE_NAMES,
  colorNameToHex
} from '../utils/tasksheetParser'
import { utmToLatLon } from '../utils/coordinatesWGS84'
import { Task, Goal, GoalType, TaskType } from '../../shared/types'

// PDF.js dynamisch laden für Worker-Kompatibilität
let pdfjsLib: any = null
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib
  // @ts-ignore
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js')

  // Worker-Pfad setzen - funktioniert für Dev und Production
  // In Dev: /pdf.worker.min.js wird vom Vite Dev Server bereitgestellt
  // In Production: Relativer Pfad vom index.html aus
  const isProduction = !window.location.href.includes('localhost')
  if (isProduction) {
    // Im Production-Modus: Relativer Pfad zum Worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js'
  } else {
    // Im Dev-Modus: Absoluter Pfad vom Dev-Server
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
  }

  return pdfjsLib
}

// Task-Type Mapping (außerhalb der Komponente für Callback-Zugriff)
const TASK_TYPE_MAP: Record<string, TaskType> = {
  'PDG': TaskType.PDG,
  'JDG': TaskType.JDG,
  'HWZ': TaskType.HWZ,
  'FIN': TaskType.FIN,
  'FON': TaskType.FON,
  'HNH': TaskType.HNH,
  'WSD': TaskType.WSD,
  'GBM': TaskType.GBM,
  'CRT': TaskType.CRT,
  'RTA': TaskType.RTA,
  'ELB': TaskType.ELB,
  'LRN': TaskType.LRN,
  'MDT': TaskType.MDT,
  'MDD': TaskType.MDD,
  'XDI': TaskType.XDI,
  'XDT': TaskType.XDT,
  'XDD': TaskType.XDD,
  'ANG': TaskType.ANG,
  'SFL': TaskType.SFL,
  '3DT': TaskType.ThreeD,
  'LTT': TaskType.LTT,
  'MTT': TaskType.MTT,
  'APT': TaskType.APT
}

// Importiere Tasks direkt über den Store (für Callback nach Map-Klick)
// WICHTIG: Bei Tasks mit mehreren Goals (z.B. HWZ A, B, C) wird für jedes Goal ein separater Task erstellt
function importTasksDirectly(
  tasksToImport: ParsedTask[],
  manualPositions: Map<number, { lat: number; lon: number }>,
  settings: {
    utmZone: number
    utmBaseEasting: number
    utmBaseNorthing: number
    taskMarkerColors: string[]
    loggerLabelPrefix: string
    loggerGoalLabelPrefix?: string
    defaultMmaRadius: number
    mmaFillDashed: boolean
  },
  store: ReturnType<typeof useFlightStore.getState>,
  // NEU: Karten-Bounds für intelligente Quadrat-Auswahl (wie OZI Explorer)
  mapBounds?: { minE: number; maxE: number; minN: number; maxN: number }
) {
  console.log('[Tasksheet] importTasksDirectly aufgerufen mit', tasksToImport.length, 'Tasks')

  let lastTask: Task | null = null
  let lastGoal: Goal | null = null

  // UTM Base: Verwende die übergebenen Settings (bereits korrekt berechnet aus Wettkampfkarte oder Settings)
  const effectiveBaseEasting = settings.utmBaseEasting
  const effectiveBaseNorthing = settings.utmBaseNorthing

  console.log('[Tasksheet] importTasksDirectly UTM Base:', {
    effectiveBase: { effectiveBaseEasting, effectiveBaseNorthing },
    utmZone: settings.utmZone,
    mapBounds
  })

  for (const parsedTask of tasksToImport) {
    // Task-Farbe: Wenn im Tasksheet eine Farbe angegeben ist, verwende diese, sonst Fallback auf Nummer-basierte Farbe
    const recognizedColor = colorNameToHex(parsedTask.markerColor)
    const taskColor = recognizedColor || settings.taskMarkerColors[(parsedTask.taskNumber - 1) % settings.taskMarkerColors.length]

    // Rings für 3DT
    let rings: number[] | undefined
    if (parsedTask.is3DT && (parsedTask.innerRadius || parsedTask.outerRadius)) {
      const innerM = (parsedTask.innerRadius || 2) * 1000
      const outerM = (parsedTask.outerRadius || 3) * 1000
      rings = [innerM, outerM]
    }

    // Bei Tasks mit mehreren Goals (z.B. HWZ): Für jedes Goal einen separaten Task erstellen
    if (parsedTask.goals.length > 1) {
      // Mehrere Goals = mehrere separate Tasks (z.B. HWZ A, HWZ B, HWZ C)
      for (let i = 0; i < parsedTask.goals.length; i++) {
        const goalData = parsedTask.goals[i]
        const expanded = expandUTMCoordinates(
          goalData.easting,
          goalData.northing,
          effectiveBaseEasting,
          effectiveBaseNorthing,
          goalData.eastingStr,
          goalData.northingStr,
          mapBounds  // NEU: Karten-Bounds für intelligente Quadrat-Auswahl
        )
        const latLon = utmToLatLon({
          zone: settings.utmZone,
          hemisphere: 'N',
          easting: expanded.easting,
          northing: expanded.northing
        })

        const goalLabel = goalData.label || String.fromCharCode(97 + i) // a, b, c, ...
        const taskName = `${parsedTask.taskType} ${goalLabel.toUpperCase()}` // z.B. "HWZ A"

        const newGoal: Goal = {
          id: crypto.randomUUID(),
          name: taskName,
          position: {
            latitude: latLon.lat,
            longitude: latLon.lon,
            altitude: 0,
            timestamp: new Date()
          },
          radius: 100,
          type: GoalType.Ground,
          declaredBy: 'judge'
        }

        // Deaktiviere alle anderen Tasks
        store.tasks.forEach(t => {
          if (t.isActive) {
            const deactivated = { ...t, isActive: false }
            store.removeTask(t.id)
            store.addTask(deactivated)
          }
        })

        // Separater Task für jedes Goal
        const newTask: Task = {
          id: crypto.randomUUID(),
          type: TASK_TYPE_MAP[parsedTask.taskType] || TaskType.JDG,
          name: taskName,
          taskNumber: `${parsedTask.taskNumber}${goalLabel.toUpperCase()}`, // z.B. "5A", "5B", "5C"
          loggerId: parsedTask.loggerMarker ? `${settings.loggerLabelPrefix}${String(parsedTask.loggerMarker).toUpperCase()}` : undefined,
          loggerGoalId: parsedTask.loggerGoal ? `${settings.loggerGoalLabelPrefix ?? 'LG'}${String(parsedTask.loggerGoal).toUpperCase()}` : undefined,
          markerColor: taskColor,
          // Multi-Marker Support
          markerCount: parsedTask.markerCount || 1,
          markerColors: parsedTask.markerColors,
          goals: [newGoal],
          rings,
          minDistance: rings ? Math.min(...rings) : undefined,
          maxDistance: rings ? Math.max(...rings) : undefined,
          mmaRadius: parsedTask.mma !== undefined ? parsedTask.mma : settings.defaultMmaRadius,
          mmaDashed: settings.mmaFillDashed,
          endsAt: parsedTask.endTime ? formatTime(parsedTask.endTime) : undefined,
          reminderEnabled: false,
          isActive: true
        }

        store.addTask(newTask)
        lastTask = newTask
        lastGoal = newGoal
        console.log(`[Tasksheet] Task ${newTask.taskNumber} (${taskName}) importiert`)
      }
    } else {
      // Ein Goal oder kein Goal - normaler Import
      const goals: Goal[] = []

      if (parsedTask.goals.length === 1) {
        // Einzelnes Goal
        const goalData = parsedTask.goals[0]
        const expanded = expandUTMCoordinates(
          goalData.easting,
          goalData.northing,
          effectiveBaseEasting,
          effectiveBaseNorthing,
          goalData.eastingStr,
          goalData.northingStr,
          mapBounds  // NEU: Karten-Bounds für intelligente Quadrat-Auswahl
        )
        const latLon = utmToLatLon({
          zone: settings.utmZone,
          hemisphere: 'N',
          easting: expanded.easting,
          northing: expanded.northing
        })

        const newGoal: Goal = {
          id: crypto.randomUUID(),
          name: parsedTask.taskType,
          position: {
            latitude: latLon.lat,
            longitude: latLon.lon,
            altitude: 0,
            timestamp: new Date()
          },
          radius: 100,
          type: GoalType.Ground,
          declaredBy: 'judge'
        }
        goals.push(newGoal)
      } else if (manualPositions.has(parsedTask.taskNumber)) {
        // Manuell platzierter Task (per Karten-Klick)
        const pos = manualPositions.get(parsedTask.taskNumber)!
        const newGoal: Goal = {
          id: crypto.randomUUID(),
          name: parsedTask.taskType,
          position: {
            latitude: pos.lat,
            longitude: pos.lon,
            altitude: 0,
            timestamp: new Date()
          },
          radius: 100,
          type: GoalType.Ground,
          declaredBy: 'judge'
        }
        goals.push(newGoal)
        console.log(`[Tasksheet] Task ${parsedTask.taskNumber} mit manueller Position: ${pos.lat}, ${pos.lon}`)
      }

      // Deaktiviere alle anderen Tasks
      store.tasks.forEach(t => {
        if (t.isActive) {
          const deactivated = { ...t, isActive: false }
          store.removeTask(t.id)
          store.addTask(deactivated)
        }
      })

      // Task erstellen
      const newTask: Task = {
        id: crypto.randomUUID(),
        type: TASK_TYPE_MAP[parsedTask.taskType] || TaskType.JDG,
        name: parsedTask.taskType,
        taskNumber: parsedTask.taskNumber.toString(),
        loggerId: parsedTask.loggerMarker ? `${settings.loggerLabelPrefix}${String(parsedTask.loggerMarker).toUpperCase()}` : undefined,
        loggerGoalId: parsedTask.loggerGoal ? `${settings.loggerGoalLabelPrefix ?? 'LG'}${String(parsedTask.loggerGoal).toUpperCase()}` : undefined,
        markerColor: taskColor,
        // Multi-Marker Support
        markerCount: parsedTask.markerCount || 1,
        markerColors: parsedTask.markerColors,
        goals,
        rings,
        minDistance: rings ? Math.min(...rings) : undefined,
        maxDistance: rings ? Math.max(...rings) : undefined,
        mmaRadius: parsedTask.mma !== undefined ? parsedTask.mma : settings.defaultMmaRadius,
        mmaDashed: settings.mmaFillDashed,
        endsAt: parsedTask.endTime ? formatTime(parsedTask.endTime) : undefined,
        reminderEnabled: false,
        isActive: true,
        // APT Profile - übernimm Layer-Werte auch ohne Profilpunkte (Diagramm im PDF)
        aptProfile: parsedTask.taskType === 'APT'
          ? {
            points: parsedTask.aptProfilePoints && parsedTask.aptProfilePoints.length >= 2
              ? parsedTask.aptProfilePoints
              : [
                { timeMinutes: 0, altitudeFt: 2500 },
                { timeMinutes: 2, altitudeFt: 3000 },
                { timeMinutes: 4, altitudeFt: 3000 },
                { timeMinutes: 6, altitudeFt: 2000 },
                { timeMinutes: 8, altitudeFt: 2000 },
              ],
            layerAFt: parsedTask.aptLayerAFt || 50,
            layerBFt: parsedTask.aptLayerBFt || 100,
            isDefault: !(parsedTask.aptProfilePoints && parsedTask.aptProfilePoints.length >= 2),
          }
          : undefined,
      }

      store.addTask(newTask)
      lastTask = newTask
      lastGoal = goals[0]
      console.log(`[Tasksheet] Task ${parsedTask.taskNumber} (${parsedTask.taskType}) importiert mit ${goals.length} Goals`)
    }
  }

  // Letzten Task aktiv setzen
  if (lastTask && lastGoal) {
    store.setActiveTask(lastTask)
    store.setSelectedGoal(lastGoal)
  }

  console.log('[Tasksheet] Import abgeschlossen')
}

interface TasksheetImportPanelProps {
  isOpen: boolean
  onClose: () => void
  // Optional: Championship ID zum Speichern des PDFs
  championshipId?: string
  onSavePdf?: (pdfData: { name: string; data: string }) => Promise<void>
  // Optional: Bereits ausgewählte Datei (öffnet direkt ohne Auswahl-Dialog)
  initialFile?: File
}

export function TasksheetImportPanel({ isOpen, onClose, championshipId, onSavePdf, initialFile }: TasksheetImportPanelProps) {
  const { tasks, addTask, removeTask, setActiveTask, setSelectedGoal, settings, updateSettings, setTasksheetCoordPicker, activeCompetitionMap, openBackupDialog } = useFlightStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [parseResult, setParseResult] = useState<TasksheetParseResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [importStep, setImportStep] = useState<'select' | 'configure'>('select')
  // PDF Daten für Speicherung in Championship
  const [loadedPdfData, setLoadedPdfData] = useState<{ name: string; data: string } | null>(null)
  // Neuer State für Koordinaten-Bearbeitung
  const [editingTaskNumber, setEditingTaskNumber] = useState<number | null>(null)
  const [editingGoalIndex, setEditingGoalIndex] = useState<number | null>(null)
  const [editCoords, setEditCoords] = useState<{ easting: string; northing: string }>({ easting: '', northing: '' })

  // UTM Settings - Priorität: 1) aktive Wettkampfkarte, 2) Settings
  // Wenn eine Wettkampfkarte aktiv ist, verwende deren UTM-Zone und Grid-Basis
  const utmBounds = activeCompetitionMap?.utmReprojection?.utmBounds
  const hasValidUtmBounds = utmBounds &&
    typeof utmBounds.minE === 'number' && !isNaN(utmBounds.minE) &&
    typeof utmBounds.minN === 'number' && !isNaN(utmBounds.minN)

  // UTM Zone: Priorität 1) Map utmReprojection, 2) Map utmZone, 3) Settings
  const utmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone || settings.utmZone || 33

  // UTM Base: Wenn Wettkampfkarte aktiv ist, berechne Grid-Basis aus deren Bounds
  let utmBaseEasting = settings.utmBaseEasting || 500000
  let utmBaseNorthing = settings.utmBaseNorthing || 5300000

  if (hasValidUtmBounds) {
    // Berechne 100km-Quadrat-Basis aus der Wettkampfkarte
    utmBaseEasting = Math.floor(utmBounds.minE / 100000) * 100000
    utmBaseNorthing = Math.floor(utmBounds.minN / 100000) * 100000
    console.log('[TasksheetImport] UTM Base aus Karte:', { utmBaseEasting, utmBaseNorthing, utmBounds })
  } else {
    console.log('[TasksheetImport] KEINE gültigen UTM Bounds!', {
      activeCompetitionMap: activeCompetitionMap?.name,
      utmReprojection: activeCompetitionMap?.utmReprojection,
      utmBounds,
      hasValidUtmBounds
    })
  }

  // Datei verarbeiten (PDF oder Text)
  const processFile = async (file: File) => {
    setIsLoading(true)

    try {
      let text = ''

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // PDF als Base64 speichern für späteren Zugriff
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        setLoadedPdfData({ name: file.name, data: base64 })

        // PDF parsen mit pdfjs-dist
        // WICHTIG: Gruppiere Text-Items nach Y-Position (Zeilen), um Spaltenstruktur zu erhalten
        const pdfjs = await loadPdfJs()
        // disableWorker: true vermeidet Worker-Pfad-Probleme im Electron-Build
        // PDF.js läuft dann im Main Thread (ausreichend für kleine Tasksheet-PDFs)
        const pdf = await pdfjs.getDocument({ data: arrayBuffer, disableWorker: true }).promise

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()

          // Gruppiere Text-Items nach Y-Position (mit Toleranz von 3 Einheiten)
          const lineGroups = new Map<number, { x: number; text: string }[]>()

          for (const item of textContent.items as any[]) {
            if (!item.str || item.str.trim() === '') continue

            const y = Math.round(item.transform[5]) // Y-Position
            const x = Math.round(item.transform[4]) // X-Position

            // Finde existierende Zeile mit ähnlicher Y-Position (Toleranz 3)
            let foundY: number | null = null
            for (const existingY of lineGroups.keys()) {
              if (Math.abs(existingY - y) <= 3) {
                foundY = existingY
                break
              }
            }

            const targetY = foundY ?? y
            if (!lineGroups.has(targetY)) {
              lineGroups.set(targetY, [])
            }
            lineGroups.get(targetY)!.push({ x, text: item.str })
          }

          // Sortiere Zeilen nach Y-Position (von oben nach unten, Y ist invertiert in PDF)
          const sortedYs = Array.from(lineGroups.keys()).sort((a, b) => b - a)

          // Baue Text auf - sortiere Items in jeder Zeile nach X-Position
          for (const y of sortedYs) {
            const items = lineGroups.get(y)!.sort((a, b) => a.x - b.x)
            const lineText = items.map(item => item.text).join(' ')
            text += lineText + '\n'
          }

          // ═══ APT Diagramm-Erkennung: Profillinie aus PDF-Grafik extrahieren ═══
          // Prüfe ob diese Seite ein APT-Diagramm enthält (Altitude/feet + Time/minutes)
          const allItems = Array.from(lineGroups.values()).flat()
          const hasAltitudeLabel = allItems.some(it => /altitude|höhe/i.test(it.text))
          const hasTimeLabel = allItems.some(it => /time.*minutes|minuten/i.test(it.text))
          const hasFeetLabel = allItems.some(it => /feet|ft/i.test(it.text))

          console.log(`[APT-Debug] Seite ${i}: hasAltitude=${hasAltitudeLabel}, hasTime=${hasTimeLabel}, hasFeet=${hasFeetLabel}`)
          console.log(`[APT-Debug] Seite ${i}: Alle Text-Items (${allItems.length}):`)
          for (const it of allItems) {
            console.log(`  x=${it.x.toFixed(0)} text="${it.text}"`)
          }

          if (hasAltitudeLabel && (hasTimeLabel || hasFeetLabel)) {
            console.log(`[APT-Debug] ═══ APT-Diagramm erkannt auf Seite ${i} ═══`)
            try {
              // Schritt 1: Y-Achse erkennen (Höhenwerte links vom Diagramm)
              // Suche nach Zahlen >= 500 mit kleiner X-Position (linke Seite)
              const yAxisLabels: { pixelY: number; altFt: number }[] = []
              const xAxisLabels: { pixelX: number; timeMin: number }[] = []

              const allYPositions = Array.from(lineGroups.keys())
              const maxY = Math.max(...allYPositions)
              const minY = Math.min(...allYPositions)
              console.log(`[APT-Debug] Y-Bereich der Seite: min=${minY}, max=${maxY}`)

              for (const [lineY, items] of lineGroups.entries()) {
                for (const item of items) {
                  const num = parseInt(item.text.trim())
                  if (isNaN(num)) continue

                  // Y-Achse: Höhenwerte (500-10000 ft), X-Position < 120 (links)
                  if (num >= 500 && num <= 10000 && item.x < 120) {
                    yAxisLabels.push({ pixelY: lineY, altFt: num })
                    console.log(`[APT-Debug] Y-Achsen-Label gefunden: ${num}ft @ pixelY=${lineY}, x=${item.x}`)
                  }

                  // X-Achse: Minutenwerte (1-30), Y-Position niedrig (unten im PDF)
                  if (num >= 1 && num <= 30 && item.x > 100) {
                    // Nur Items die in der unteren Hälfte der Seite sind
                    if (lineY < maxY * 0.5) {
                      xAxisLabels.push({ pixelX: item.x, timeMin: num })
                      console.log(`[APT-Debug] X-Achsen-Label gefunden: ${num}min @ pixelX=${item.x}, pixelY=${lineY}`)
                    } else {
                      console.log(`[APT-Debug] X-Achsen-Kandidat VERWORFEN (y=${lineY} >= ${(maxY * 0.5).toFixed(0)}): ${num}min @ x=${item.x}`)
                    }
                  }
                }
              }

              console.log(`[APT-Debug] Y-Achse: ${yAxisLabels.length} Labels gefunden`)
              console.log(`[APT-Debug] X-Achse: ${xAxisLabels.length} Labels gefunden`)

              if (yAxisLabels.length >= 2 && xAxisLabels.length >= 2) {
                // Sortiere Achsen
                yAxisLabels.sort((a, b) => a.pixelY - b.pixelY)
                xAxisLabels.sort((a, b) => a.pixelX - b.pixelX)

                console.log(`[APT-Debug] Y-Achse (sortiert): ${yAxisLabels.map(l => `${l.altFt}ft@y${l.pixelY}`).join(', ')}`)
                console.log(`[APT-Debug] X-Achse (sortiert): ${xAxisLabels.map(l => `${l.timeMin}min@x${l.pixelX}`).join(', ')}`)

                // Schritt 2: Grafik-Operatoren der Seite parsen (Linien/Pfade)
                const ops = await page.getOperatorList()
                const OPS = (pdfjs as any).OPS || {}

                console.log(`[APT-Debug] PDF OPS Konstanten: moveTo=${OPS.moveTo}, lineTo=${OPS.lineTo}, curveTo=${OPS.curveTo}, curveTo2=${OPS.curveTo2}, curveTo3=${OPS.curveTo3}`)
                console.log(`[APT-Debug] Operator-Liste: ${ops.fnArray.length} Operatoren`)

                // Zähle Operator-Typen
                const opCounts: Record<number, number> = {}
                for (const fn of ops.fnArray) {
                  opCounts[fn] = (opCounts[fn] || 0) + 1
                }
                console.log(`[APT-Debug] Operator-Typen:`, Object.entries(opCounts).map(([k, v]) => `${k}=${v}`).join(', '))

                // Sammle alle Linienpunkte aus den PDF-Operatoren
                const pathPoints: { x: number; y: number }[] = []
                let currentX = 0, currentY = 0
                let moveToCount = 0, lineToCount = 0

                for (let opIdx = 0; opIdx < ops.fnArray.length; opIdx++) {
                  const fn = ops.fnArray[opIdx]
                  const args = ops.argsArray[opIdx]

                  if (fn === OPS.moveTo && args) {
                    currentX = args[0]; currentY = args[1]
                    pathPoints.push({ x: currentX, y: currentY })
                    moveToCount++
                  } else if (fn === OPS.lineTo && args) {
                    currentX = args[0]; currentY = args[1]
                    pathPoints.push({ x: currentX, y: currentY })
                    lineToCount++
                  }
                }

                console.log(`[APT-Debug] Pfad-Punkte: ${pathPoints.length} (moveTo=${moveToCount}, lineTo=${lineToCount})`)

                if (pathPoints.length > 0) {
                  // Zeige die ersten 30 Punkte
                  console.log(`[APT-Debug] Erste 30 Pfad-Punkte:`)
                  for (let pIdx = 0; pIdx < Math.min(30, pathPoints.length); pIdx++) {
                    console.log(`  [${pIdx}] x=${pathPoints[pIdx].x.toFixed(1)}, y=${pathPoints[pIdx].y.toFixed(1)}`)
                  }

                  // Schritt 3: Pixel→Wert Mapping mit linearer Interpolation
                  const pixelToAlt = (py: number): number | null => {
                    if (yAxisLabels.length < 2) return null
                    // Finde die zwei nächsten Y-Labels
                    for (let j = 0; j < yAxisLabels.length - 1; j++) {
                      const l1 = yAxisLabels[j], l2 = yAxisLabels[j + 1]
                      if ((py >= l1.pixelY && py <= l2.pixelY) || (py <= l1.pixelY && py >= l2.pixelY)) {
                        const frac = (py - l1.pixelY) / (l2.pixelY - l1.pixelY)
                        return l1.altFt + (l2.altFt - l1.altFt) * frac
                      }
                    }
                    // Extrapolation
                    const l1 = yAxisLabels[0], l2 = yAxisLabels[yAxisLabels.length - 1]
                    const frac = (py - l1.pixelY) / (l2.pixelY - l1.pixelY)
                    return l1.altFt + (l2.altFt - l1.altFt) * frac
                  }

                  const pixelToTime = (px: number): number | null => {
                    if (xAxisLabels.length < 2) return null
                    for (let j = 0; j < xAxisLabels.length - 1; j++) {
                      const l1 = xAxisLabels[j], l2 = xAxisLabels[j + 1]
                      if (px >= l1.pixelX && px <= l2.pixelX) {
                        const frac = (px - l1.pixelX) / (l2.pixelX - l1.pixelX)
                        return l1.timeMin + (l2.timeMin - l1.timeMin) * frac
                      }
                    }
                    // Extrapolation
                    const l1 = xAxisLabels[0], l2 = xAxisLabels[xAxisLabels.length - 1]
                    const frac = (px - l1.pixelX) / (l2.pixelX - l1.pixelX)
                    return l1.timeMin + (l2.timeMin - l1.timeMin) * frac
                  }

                  // Schritt 4: Filtere Punkte die im Diagramm-Bereich liegen
                  const xMin = xAxisLabels[0].pixelX - 10
                  const xMax = xAxisLabels[xAxisLabels.length - 1].pixelX + 10
                  const yMin = Math.min(...yAxisLabels.map(l => l.pixelY)) - 10
                  const yMax = Math.max(...yAxisLabels.map(l => l.pixelY)) + 10

                  console.log(`[APT-Debug] Diagramm-Bereich: x=[${xMin.toFixed(0)}, ${xMax.toFixed(0)}], y=[${yMin.toFixed(0)}, ${yMax.toFixed(0)}]`)

                  const diagramPoints = pathPoints.filter(p =>
                    p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax
                  )

                  console.log(`[APT-Debug] Punkte im Diagramm-Bereich: ${diagramPoints.length} von ${pathPoints.length}`)
                  for (const dp of diagramPoints) {
                    const t = pixelToTime(dp.x)
                    const a = pixelToAlt(dp.y)
                    console.log(`  pixel(${dp.x.toFixed(1)}, ${dp.y.toFixed(1)}) → time=${t?.toFixed(2)}min, alt=${a?.toFixed(0)}ft`)
                  }

                  if (diagramPoints.length >= 3) {
                    // Konvertiere Pixel zu Werten
                    const profileCandidates: { timeMinutes: number; altitudeFt: number }[] = []
                    for (const p of diagramPoints) {
                      const t = pixelToTime(p.x)
                      const a = pixelToAlt(p.y)
                      if (t !== null && a !== null && t >= -0.5 && a > 0) {
                        profileCandidates.push({
                          timeMinutes: Math.round(t * 2) / 2,  // Auf 0.5 min runden
                          altitudeFt: Math.round(a / 25) * 25   // Auf 25 ft runden
                        })
                      }
                    }

                    console.log(`[APT-Debug] Profil-Kandidaten (gerundet): ${profileCandidates.length}`)
                    for (const pc of profileCandidates) {
                      console.log(`  ${pc.timeMinutes}min = ${pc.altitudeFt}ft`)
                    }

                    // Sortiere nach Zeit und entferne Duplikate
                    profileCandidates.sort((a, b) => a.timeMinutes - b.timeMinutes)
                    const uniqueProfile: typeof profileCandidates = []
                    for (const p of profileCandidates) {
                      if (uniqueProfile.length === 0 || uniqueProfile[uniqueProfile.length - 1].timeMinutes !== p.timeMinutes) {
                        uniqueProfile.push(p)
                      }
                    }

                    console.log(`[APT-Debug] Unique Profil (nach Deduplizierung): ${uniqueProfile.length}`)
                    for (const up of uniqueProfile) {
                      console.log(`  ${up.timeMinutes}min = ${up.altitudeFt}ft`)
                    }

                    // Vereinfache: Nur Wendepunkte behalten (wo sich die Richtung ändert)
                    if (uniqueProfile.length >= 3) {
                      const simplified: typeof uniqueProfile = [uniqueProfile[0]]
                      for (let j = 1; j < uniqueProfile.length - 1; j++) {
                        const prev = uniqueProfile[j - 1]
                        const curr = uniqueProfile[j]
                        const next = uniqueProfile[j + 1]
                        const prevSlope = curr.altitudeFt - prev.altitudeFt
                        const nextSlope = next.altitudeFt - curr.altitudeFt
                        const isInflection = Math.sign(prevSlope) !== Math.sign(nextSlope) || Math.abs(prevSlope) > 50
                        console.log(`[APT-Debug] Punkt ${j}: ${curr.timeMinutes}min=${curr.altitudeFt}ft, prevSlope=${prevSlope}, nextSlope=${nextSlope}, isInflection=${isInflection}`)
                        // Wendepunkt: Richtungsänderung oder signifikante Höhenänderung
                        if (isInflection) {
                          simplified.push(curr)
                        }
                      }
                      simplified.push(uniqueProfile[uniqueProfile.length - 1])

                      console.log(`[APT-Debug] Vereinfacht (Wendepunkte): ${simplified.length} Punkte`)
                      for (const sp of simplified) {
                        console.log(`  ${sp.timeMinutes}min = ${sp.altitudeFt}ft`)
                      }

                      if (simplified.length >= 2) {
                        // Injiziere die erkannten Punkte als Text
                        const aptText = simplified.map(p =>
                          `${p.timeMinutes} min ${p.altitudeFt}ft`
                        ).join('\n')
                        text += `\n${aptText}\n`
                        console.log(`[APT-Diagramm] ✓ ${simplified.length} Profil-Punkte aus Diagramm extrahiert:`,
                          simplified.map(p => `${p.timeMinutes}min=${p.altitudeFt}ft`).join(', '))
                      } else {
                        console.warn(`[APT-Debug] ✗ Zu wenige vereinfachte Punkte (${simplified.length} < 2)`)
                      }
                    } else {
                      console.warn(`[APT-Debug] ✗ Zu wenige unique Punkte für Vereinfachung (${uniqueProfile.length} < 3)`)
                    }
                  } else {
                    console.warn(`[APT-Debug] ✗ Zu wenige Punkte im Diagramm-Bereich (${diagramPoints.length} < 3)`)
                  }
                } else {
                  console.warn(`[APT-Debug] ✗ Keine Pfad-Punkte gefunden (moveTo/lineTo)`)
                }
              } else {
                console.warn(`[APT-Debug] ✗ Zu wenige Achsen-Labels: Y=${yAxisLabels.length} (brauche >=2), X=${xAxisLabels.length} (brauche >=2)`)
              }
            } catch (aptErr) {
              console.error('[APT-Debug] ✗ FEHLER bei Diagramm-Erkennung:', aptErr)
              console.error('[APT-Debug] Stack:', (aptErr as any)?.stack)
            }
          } else {
            console.log(`[APT-Debug] Seite ${i}: Kein APT-Diagramm (altitude=${hasAltitudeLabel}, time=${hasTimeLabel}, feet=${hasFeetLabel})`)
          }

          text += `\n--- Page ${i} ---\n`
          console.log(`[Tasksheet] Page ${i} extracted with ${lineGroups.size} lines`)
        }
        console.log('[Tasksheet] PDF Gesamt-Text:', text.substring(0, 2000))
      } else {
        // Text-Datei direkt lesen
        text = await file.text()
        setLoadedPdfData(null) // Kein PDF zum Speichern
      }

      processText(text)
    } catch (err) {
      console.error('Fehler beim Lesen:', err)
      setParseResult({
        success: false,
        date: null,
        flight: null,
        qnh: null,
        startPeriodEnd: null,
        tasks: [],
        errors: [`Fehler beim Lesen der Datei: ${err}`]
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Text verarbeiten
  const processText = (text: string) => {
    const result = parseTasksheetText(text)
    setParseResult(result)

    if (result.success) {
      setSelectedTasks(new Set(result.tasks.map(t => t.taskNumber)))
      setImportStep('configure')
    }
  }

  // Wrapper für file input onChange
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await processFile(file)
    }
  }

  // Automatisch initialFile verarbeiten wenn vorhanden
  useEffect(() => {
    if (initialFile && isOpen) {
      processFile(initialFile)
    }
  }, [initialFile, isOpen])

  // Task-Auswahl umschalten
  const toggleTaskSelection = (taskNumber: number) => {
    const newSelection = new Set(selectedTasks)
    if (newSelection.has(taskNumber)) {
      newSelection.delete(taskNumber)
    } else {
      newSelection.add(taskNumber)
    }
    setSelectedTasks(newSelection)
  }

  // Backup-Dialog anzeigen (wird nach dem Import aller Tasks aufgerufen)
  const showBackupDialogIfNeeded = () => {
    const store = useFlightStore.getState()
    console.log('[Tasksheet] Alle Tasks importiert, prüfe activeChampionship:', store.activeChampionship)
    if (store.activeChampionship) {
      console.log('[Tasksheet] Öffne Backup-Dialog für:', store.activeChampionship.name)
      store.openBackupDialog()
    }
  }

  // Import starten
  const startImport = async () => {
    if (!parseResult) return

    const tasksToImport = parseResult.tasks.filter(t => selectedTasks.has(t.taskNumber))
    const tasksWithCoords = tasksToImport.filter(t => !t.needsUserInput)
    const tasksWithoutCoords = tasksToImport.filter(t => t.needsUserInput)

    // Zuerst: Tasks MIT Koordinaten sofort importieren (werden auf der Karte angezeigt)
    if (tasksWithCoords.length > 0) {
      console.log(`[Tasksheet] Importiere ${tasksWithCoords.length} Tasks mit Koordinaten...`)
      await importAllTasks(tasksWithCoords, new Map(), tasksWithoutCoords.length === 0) // Backup-Dialog nur wenn keine manuellen Tasks folgen
    }

    // Dann: Wenn es Tasks ohne Koordinaten gibt, in den Karten-Klick-Modus wechseln
    if (tasksWithoutCoords.length > 0) {
      const tasksNeedingCoordsCopy = [...tasksWithoutCoords]
      const firstTask = tasksNeedingCoordsCopy[0]
      const remainingTasks = tasksNeedingCoordsCopy.slice(1)

      // Kopiere Settings für den Callback
      const capturedSettings = {
        utmZone,
        utmBaseEasting,
        utmBaseNorthing,
        taskMarkerColors: settings.taskMarkerColors || ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#64748b'],
        loggerLabelPrefix: settings.loggerLabelPrefix ?? 'LM',
        loggerGoalLabelPrefix: settings.loggerGoalLabelPrefix ?? 'LG',
        defaultMmaRadius: settings.defaultMmaRadius || 100,
        mmaFillDashed: settings.mmaFillDashed || false
      }

      // Kopiere mapBounds für intelligente Quadrat-Auswahl (wie OZI Explorer)
      const capturedMapBounds = utmBounds ? { ...utmBounds } : undefined

      // Rekursive Funktion um Tasks nacheinander zu platzieren
      const placeNextTask = (
        taskNumber: number,
        taskType: string,
        positions: Map<number, { lat: number; lon: number }>,
        remaining: ParsedTask[]
      ) => {
        const store = useFlightStore.getState()
        store.setTasksheetCoordPicker({
          active: true,
          taskNumber: taskNumber,
          taskType: taskType,
          callback: (lat, lon) => {
            // Koordinaten wurden auf der Karte geklickt
            positions.set(taskNumber, { lat, lon })
            console.log(`[Tasksheet] Task ${taskNumber} platziert bei ${lat}, ${lon}`)

            // Importiere diesen einen Task sofort (damit er auf der Karte erscheint)
            const taskToImport = tasksWithoutCoords.find(t => t.taskNumber === taskNumber)
            if (taskToImport) {
              importTasksDirectly([taskToImport], positions, capturedSettings, store, capturedMapBounds)
            }

            if (remaining.length > 0) {
              // Nächsten Task platzieren
              const nextTask = remaining[0]
              const nextRemaining = remaining.slice(1)
              console.log(`[Tasksheet] Nächster Task: ${nextTask.taskNumber} (${nextTask.taskType})`)

              // Kurze Verzögerung damit der UI-State sich aktualisieren kann
              setTimeout(() => {
                placeNextTask(nextTask.taskNumber, nextTask.taskType, positions, nextRemaining)
              }, 100)
            } else {
              // ALLE Tasks platziert - jetzt Backup-Dialog anzeigen
              console.log(`[Tasksheet] Alle Tasks platziert!`)
              showBackupDialogIfNeeded()
            }
          }
        })
      }

      // Starte direkt mit dem ersten Task - Panel schließen damit die Karte sichtbar ist
      placeNextTask(firstTask.taskNumber, firstTask.taskType, new Map(), remainingTasks)
      onClose()
    } else {
      // Alle Tasks hatten Koordinaten - wird in importAllTasks behandelt
    }
  }

  // Alle Tasks importieren (wie im BriefingPanel)
  // WICHTIG: Bei Tasks mit mehreren Goals (z.B. HWZ A, B, C) wird für jedes Goal ein separaten Task erstellt
  const importAllTasks = async (
    tasksToImport: ParsedTask[],
    manualPositions: Map<number, { lat: number; lon: number }>,
    showBackupAfter: boolean = true // Backup-Dialog nach dem Import anzeigen?
  ) => {
    const availableColors = settings.taskMarkerColors || ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#64748b']
    const loggerPrefix = settings.loggerLabelPrefix ?? 'LM'
    const defaultMma = settings.defaultMmaRadius || 100

    let lastTask: Task | null = null
    let lastGoal: Goal | null = null

    // UTM Base: Wenn Wettkampfkarte aktiv ist, verwende deren Grid (bereits oben berechnet)
    // Ansonsten verwende die Settings-Werte (utmBaseEasting/utmBaseNorthing sind bereits korrekt gesetzt)
    const effectiveBaseEasting = utmBaseEasting
    const effectiveBaseNorthing = utmBaseNorthing

    console.log('[TasksheetImport] Import mit UTM Base:', {
      effectiveBaseEasting,
      effectiveBaseNorthing,
      utmZone,
      fromCompetitionMap: hasValidUtmBounds,
      activeMapName: activeCompetitionMap?.name
    })

    // Task-Type mapping
    const taskTypeMap: Record<string, TaskType> = {
      'PDG': TaskType.PDG,
      'JDG': TaskType.JDG,
      'HWZ': TaskType.HWZ,
      'FIN': TaskType.FIN,
      'FON': TaskType.FON,
      'HNH': TaskType.HNH,
      'WSD': TaskType.WSD,
      'GBM': TaskType.GBM,
      'CRT': TaskType.CRT,
      'RTA': TaskType.RTA,
      'ELB': TaskType.ELB,
      'LRN': TaskType.LRN,
      'MDT': TaskType.MDT,
      'MDD': TaskType.MDD,
      'XDI': TaskType.XDI,
      'XDT': TaskType.XDT,
      'XDD': TaskType.XDD,
      'ANG': TaskType.ANG,
      'SFL': TaskType.SFL,
      '3DT': TaskType.ThreeD,
      'LTT': TaskType.LTT,
      'MTT': TaskType.MTT
    }

    for (const parsedTask of tasksToImport) {
      // Task-Farbe: Wenn im Tasksheet eine Farbe angegeben ist, verwende diese, sonst Fallback auf Nummer-basierte Farbe
      const recognizedColor = colorNameToHex(parsedTask.markerColor)
      const taskColor = recognizedColor || availableColors[(parsedTask.taskNumber - 1) % availableColors.length]

      // Rings für 3DT
      let rings: number[] | undefined
      if (parsedTask.is3DT && (parsedTask.innerRadius || parsedTask.outerRadius)) {
        const innerM = (parsedTask.innerRadius || 2) * 1000
        const outerM = (parsedTask.outerRadius || 3) * 1000
        rings = [innerM, outerM]
      }

      // Bei Tasks mit mehreren Goals (z.B. HWZ): Für jedes Goal einen separaten Task erstellen
      if (parsedTask.goals.length > 1) {
        // Mehrere Goals = mehrere separate Tasks (z.B. HWZ A, HWZ B, HWZ C)
        for (let i = 0; i < parsedTask.goals.length; i++) {
          const goalData = parsedTask.goals[i]

          const expanded = expandUTMCoordinates(
            goalData.easting,
            goalData.northing,
            effectiveBaseEasting,
            effectiveBaseNorthing,
            goalData.eastingStr,
            goalData.northingStr,
            utmBounds || undefined  // NEU: Karten-Bounds für intelligente Quadrat-Auswahl
          )

          const latLon = utmToLatLon({
            zone: utmZone,
            hemisphere: 'N',
            easting: expanded.easting,
            northing: expanded.northing
          })

          const goalLabel = goalData.label || String.fromCharCode(97 + i) // a, b, c, ...
          const taskName = `${parsedTask.taskType} ${goalLabel.toUpperCase()}` // z.B. "HWZ A"

          const newGoal: Goal = {
            id: crypto.randomUUID(),
            name: taskName,
            position: {
              latitude: latLon.lat,
              longitude: latLon.lon,
              altitude: 0,
              timestamp: new Date()
            },
            radius: 100,
            type: GoalType.Ground,
            declaredBy: 'judge'
          }

          // Deaktiviere alle anderen Tasks
          tasks.forEach(t => {
            if (t.isActive) {
              const deactivated = { ...t, isActive: false }
              removeTask(t.id)
              addTask(deactivated)
            }
          })

          // Separater Task für jedes Goal
          const newTask: Task = {
            id: crypto.randomUUID(),
            type: taskTypeMap[parsedTask.taskType] || TaskType.JDG,
            name: taskName,
            taskNumber: `${parsedTask.taskNumber}${goalLabel.toUpperCase()}`, // z.B. "5A", "5B", "5C"
            loggerId: parsedTask.loggerMarker ? `${loggerPrefix}${String(parsedTask.loggerMarker).toUpperCase()}` : undefined,
            loggerGoalId: parsedTask.loggerGoal ? `${settings.loggerGoalLabelPrefix ?? 'LG'}${String(parsedTask.loggerGoal).toUpperCase()}` : undefined,
            markerColor: taskColor,
            // Multi-Marker Support
            markerCount: parsedTask.markerCount || 1,
            markerColors: parsedTask.markerColors,
            goals: [newGoal],
            rings,
            minDistance: rings ? Math.min(...rings) : undefined,
            maxDistance: rings ? Math.max(...rings) : undefined,
            mmaRadius: parsedTask.mma !== undefined ? parsedTask.mma : defaultMma,
            mmaDashed: settings.mmaFillDashed || false,
            endsAt: parsedTask.endTime ? formatTime(parsedTask.endTime) : undefined,
            reminderEnabled: false,
            isActive: true
          }

          addTask(newTask)
          lastTask = newTask
          lastGoal = newGoal
        }
      } else {
        // Ein Goal oder kein Goal - normaler Import
        const goals: Goal[] = []

        if (parsedTask.goals.length === 1) {
          // Einzelnes Goal
          const goalData = parsedTask.goals[0]

          // DEBUG: Zeige Input-Koordinaten
          const expanded = expandUTMCoordinates(
            goalData.easting,
            goalData.northing,
            effectiveBaseEasting,
            effectiveBaseNorthing,
            goalData.eastingStr,
            goalData.northingStr,
            utmBounds || undefined  // NEU: Karten-Bounds für intelligente Quadrat-Auswahl
          )

          const latLon = utmToLatLon({
            zone: utmZone,
            hemisphere: 'N',
            easting: expanded.easting,
            northing: expanded.northing
          })

          const newGoal: Goal = {
            id: crypto.randomUUID(),
            name: parsedTask.taskType,
            position: {
              latitude: latLon.lat,
              longitude: latLon.lon,
              altitude: 0,
              timestamp: new Date()
            },
            radius: 100,
            type: GoalType.Ground,
            declaredBy: 'judge'
          }
          goals.push(newGoal)
        } else if (manualPositions.has(parsedTask.taskNumber)) {
          // Manuell platzierter Task
          const pos = manualPositions.get(parsedTask.taskNumber)!
          const newGoal: Goal = {
            id: crypto.randomUUID(),
            name: parsedTask.taskType,
            position: {
              latitude: pos.lat,
              longitude: pos.lon,
              altitude: 0,
              timestamp: new Date()
            },
            radius: 100,
            type: GoalType.Ground,
            declaredBy: 'judge'
          }
          goals.push(newGoal)
        }

        // Deaktiviere alle anderen Tasks
        tasks.forEach(t => {
          if (t.isActive) {
            const deactivated = { ...t, isActive: false }
            removeTask(t.id)
            addTask(deactivated)
          }
        })

        // Task erstellen (wie im BriefingPanel)
        const newTask: Task = {
          id: crypto.randomUUID(),
          type: taskTypeMap[parsedTask.taskType] || TaskType.JDG,
          name: parsedTask.taskType,
          taskNumber: parsedTask.taskNumber.toString(),
          loggerId: parsedTask.loggerMarker ? `${loggerPrefix}${String(parsedTask.loggerMarker).toUpperCase()}` : undefined,
          loggerGoalId: parsedTask.loggerGoal ? `${settings.loggerGoalLabelPrefix ?? 'LG'}${String(parsedTask.loggerGoal).toUpperCase()}` : undefined,
          markerColor: taskColor,
          // Multi-Marker Support
          markerCount: parsedTask.markerCount || 1,
          markerColors: parsedTask.markerColors,
          goals,
          rings,
          minDistance: rings ? Math.min(...rings) : undefined,
          maxDistance: rings ? Math.max(...rings) : undefined,
          mmaRadius: parsedTask.mma !== undefined ? parsedTask.mma : defaultMma,
          mmaDashed: settings.mmaFillDashed || false,
          endsAt: parsedTask.endTime ? formatTime(parsedTask.endTime) : undefined,
          reminderEnabled: false,
          isActive: true
        }

        addTask(newTask)
        lastTask = newTask
        lastGoal = goals[0]
      }
    }

    // Letzten Task aktiv setzen und Goal auswählen
    if (lastTask && lastGoal) {
      setActiveTask(lastTask)
      setSelectedGoal(lastGoal)
    }

    // QNH setzen wenn vorhanden
    if (parseResult?.qnh) {
      updateSettings({ qnh: parseResult.qnh })
    }

    // PDF in Meisterschaft speichern wenn vorhanden
    if (loadedPdfData && onSavePdf) {
      try {
        await onSavePdf(loadedPdfData)
        console.log('[Tasksheet] PDF in Meisterschaft gespeichert:', loadedPdfData.name)
      } catch (err) {
        console.error('[Tasksheet] Fehler beim Speichern des PDFs:', err)
      }
    }

    // Backup-Dialog nur anzeigen wenn showBackupAfter true ist
    if (showBackupAfter) {
      showBackupDialogIfNeeded()
      onClose()
    }
    // Wenn showBackupAfter false ist, wird das Panel NICHT geschlossen (es folgen noch manuelle Tasks)
  }

  if (!isOpen) return null

  // Portal-artiges Rendering: Direkt im Body, unabhängig von Parent-Skalierung
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.95)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50000,
      // Reset alle transforms vom Parent
      transform: 'none',
      transformOrigin: 'center center'
    }} onClick={onClose}>
      <div style={{
        background: '#1e293b',
        borderRadius: '12px',
        width: '700px',
        minWidth: '600px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        minHeight: '400px',
        boxShadow: '0 25px 80px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        // Feste Skalierung - nicht von Parent beeinflusst
        transform: 'scale(1)',
        transformOrigin: 'center center',
        fontSize: '14px'
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(0,0,0,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
              Tasksheet importieren
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer', padding: '4px'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px', background: '#1e293b' }}>

          {/* Datei auswählen oder Laden-Indikator */}
          {importStep === 'select' && !parseResult && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              {isLoading ? (
                // Lade-Indikator wenn initialFile verarbeitet wird
                <>
                  <div style={{
                    width: '80px', height: '80px', borderRadius: '50%',
                    background: 'rgba(59, 130, 246, 0.15)', margin: '0 auto 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '3px solid rgba(59, 130, 246, 0.3)'
                  }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10" />
                    </svg>
                  </div>
                  <div style={{ fontSize: '14px', color: '#fff', marginBottom: '8px' }}>
                    {initialFile?.name || 'Tasksheet wird geladen...'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                    Bitte warten...
                  </div>
                </>
              ) : (
                // Datei-Auswahl UI (nur wenn kein initialFile)
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />

                  <div style={{
                    width: '80px', height: '80px', borderRadius: '50%',
                    background: 'rgba(59, 130, 246, 0.1)', margin: '0 auto 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>

                  <div style={{ fontSize: '14px', color: '#fff', marginBottom: '8px' }}>
                    Tasksheet-PDF auswählen
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px' }}>
                    PDF oder TXT Datei mit Task-Informationen
                  </div>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '12px 24px',
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      border: 'none', borderRadius: '8px',
                      color: '#fff', fontSize: '14px', fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Datei auswählen
                  </button>
                </>
              )}
            </div>
          )}

          {/* Fehler anzeigen */}
          {parseResult && !parseResult.success && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px', padding: '16px', marginBottom: '16px'
            }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#ef4444', marginBottom: '8px' }}>
                Fehler beim Parsen
              </div>
              {parseResult.errors.map((err, idx) => (
                <div key={idx} style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                  {err}
                </div>
              ))}
              <button
                onClick={() => { setParseResult(null); setImportStep('select') }}
                style={{
                  marginTop: '12px', padding: '8px 16px',
                  background: 'rgba(255,255,255,0.1)', border: 'none',
                  borderRadius: '6px', color: '#fff', fontSize: '12px', cursor: 'pointer'
                }}
              >
                Erneut versuchen
              </button>
            </div>
          )}

          {/* Task-Konfiguration mit Vorschau und Bearbeitung */}
          {importStep === 'configure' && parseResult?.success && (
            <>
              {/* Info-Header */}
              <div style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: '8px', padding: '12px', marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: 'rgba(255,255,255,0.7)', flexWrap: 'wrap' }}>
                  {parseResult.date && <span>Datum: <strong style={{ color: '#fff' }}>{parseResult.date}</strong></span>}
                  {parseResult.flight && <span>Fahrt: <strong style={{ color: '#fff' }}>{parseResult.flight}</strong></span>}
                  {parseResult.qnh && <span>QNH: <strong style={{ color: '#fff' }}>{parseResult.qnh} hPa</strong></span>}
                  {activeCompetitionMap && <span>Karte: <strong style={{ color: '#22c55e' }}>{activeCompetitionMap.name}</strong></span>}
                </div>
              </div>

              {/* Task-Liste mit Vorschau */}
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Gefundene Tasks ({parseResult.tasks.length})</span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                  Klick auf Koordinaten zum Bearbeiten
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {parseResult.tasks.map(task => (
                  <div
                    key={task.taskNumber}
                    style={{
                      padding: '12px',
                      background: task.isCancelled
                        ? 'rgba(100, 100, 100, 0.1)'
                        : selectedTasks.has(task.taskNumber)
                          ? 'rgba(59, 130, 246, 0.15)'
                          : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${task.isCancelled
                        ? 'rgba(100, 100, 100, 0.3)'
                        : selectedTasks.has(task.taskNumber)
                          ? 'rgba(59, 130, 246, 0.4)'
                          : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '8px',
                      transition: 'all 0.15s',
                      opacity: task.isCancelled ? 0.5 : 1
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1 }}>
                        {/* Checkbox */}
                        <div
                          onClick={() => !task.isCancelled && toggleTaskSelection(task.taskNumber)}
                          style={{
                            width: '20px', height: '20px', borderRadius: '4px', marginTop: '2px',
                            border: `2px solid ${task.isCancelled ? 'rgba(100,100,100,0.3)' : selectedTasks.has(task.taskNumber) ? '#3b82f6' : 'rgba(255,255,255,0.3)'}`,
                            background: selectedTasks.has(task.taskNumber) && !task.isCancelled ? '#3b82f6' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: task.isCancelled ? 'not-allowed' : 'pointer', flexShrink: 0
                          }}
                        >
                          {selectedTasks.has(task.taskNumber) && !task.isCancelled && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </div>

                        {/* Task Info */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: task.isCancelled ? 'rgba(255,255,255,0.4)' : '#fff' }}>
                              Task {task.taskNumber}
                            </span>
                            <span style={{
                              padding: '2px 8px', borderRadius: '4px',
                              background: task.isCancelled ? 'rgba(100,100,100,0.2)' : 'rgba(245, 158, 11, 0.2)',
                              color: task.isCancelled ? 'rgba(255,255,255,0.4)' : '#f59e0b', fontSize: '11px', fontWeight: 600
                            }}>
                              {task.taskType}
                            </span>
                            {task.isCancelled && (
                              <span style={{
                                padding: '2px 8px', borderRadius: '4px',
                                background: 'rgba(100, 100, 100, 0.3)',
                                color: 'rgba(255,255,255,0.5)', fontSize: '10px'
                              }}>
                                CANCELLED
                              </span>
                            )}
                            {task.needsUserInput && !task.isCancelled && (
                              <span style={{
                                padding: '2px 8px', borderRadius: '4px',
                                background: 'rgba(239, 68, 68, 0.2)',
                                color: '#ef4444', fontSize: '10px'
                              }}>
                                Koordinaten fehlen
                              </span>
                            )}
                            {task.goals.length > 0 && !task.needsUserInput && (
                              <span style={{
                                padding: '2px 8px', borderRadius: '4px',
                                background: 'rgba(34, 197, 94, 0.2)',
                                color: '#22c55e', fontSize: '10px'
                              }}>
                                {task.goals.length} Goal{task.goals.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                            {TASK_TYPE_NAMES[task.taskType] || task.taskName}
                            {task.mma > 0 && ` · MMA ${task.mma}m`}
                            {task.loggerMarker && ` · LM #${task.loggerMarker}`}
                            {task.markerColor && ` · ${task.markerColor}`}
                            {task.endTime && ` · bis ${task.endTime}`}
                          </div>

                          {/* Goals mit Bearbeitungsmöglichkeit */}
                          {task.goals.length > 0 && (
                            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {task.goals.map((g, idx) => {
                                const isEditing = editingTaskNumber === task.taskNumber && editingGoalIndex === idx
                                return (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {isEditing ? (
                                      // Bearbeitungsmodus
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <input
                                          type="text"
                                          value={editCoords.easting}
                                          onChange={e => setEditCoords(prev => ({ ...prev, easting: e.target.value }))}
                                          placeholder="E"
                                          onClick={e => e.stopPropagation()}
                                          style={{
                                            width: '50px', padding: '4px 6px',
                                            background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(59,130,246,0.5)',
                                            borderRadius: '4px', color: '#fff', fontSize: '11px'
                                          }}
                                        />
                                        <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>
                                        <input
                                          type="text"
                                          value={editCoords.northing}
                                          onChange={e => setEditCoords(prev => ({ ...prev, northing: e.target.value }))}
                                          placeholder="N"
                                          onClick={e => e.stopPropagation()}
                                          style={{
                                            width: '50px', padding: '4px 6px',
                                            background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(59,130,246,0.5)',
                                            borderRadius: '4px', color: '#fff', fontSize: '11px'
                                          }}
                                        />
                                        <button
                                          onClick={e => {
                                            e.stopPropagation()
                                            // Speichere die bearbeiteten Koordinaten
                                            if (editCoords.easting && editCoords.northing) {
                                              const updatedTasks = parseResult.tasks.map(t => {
                                                if (t.taskNumber === task.taskNumber) {
                                                  const updatedGoals = [...t.goals]
                                                  updatedGoals[idx] = {
                                                    ...updatedGoals[idx],
                                                    easting: parseInt(editCoords.easting),
                                                    northing: parseInt(editCoords.northing),
                                                    eastingStr: editCoords.easting,
                                                    northingStr: editCoords.northing
                                                  }
                                                  return { ...t, goals: updatedGoals, needsUserInput: false }
                                                }
                                                return t
                                              })
                                              setParseResult({ ...parseResult, tasks: updatedTasks })
                                            }
                                            setEditingTaskNumber(null)
                                            setEditingGoalIndex(null)
                                          }}
                                          style={{
                                            padding: '4px 8px', background: '#22c55e', border: 'none',
                                            borderRadius: '4px', color: '#fff', fontSize: '10px', cursor: 'pointer'
                                          }}
                                        >
                                          OK
                                        </button>
                                        <button
                                          onClick={e => {
                                            e.stopPropagation()
                                            setEditingTaskNumber(null)
                                            setEditingGoalIndex(null)
                                          }}
                                          style={{
                                            padding: '4px 8px', background: 'rgba(255,255,255,0.1)', border: 'none',
                                            borderRadius: '4px', color: 'rgba(255,255,255,0.6)', fontSize: '10px', cursor: 'pointer'
                                          }}
                                        >
                                          X
                                        </button>
                                      </div>
                                    ) : (
                                      // Anzeigemodus
                                      <button
                                        onClick={e => {
                                          e.stopPropagation()
                                          setEditingTaskNumber(task.taskNumber)
                                          setEditingGoalIndex(idx)
                                          setEditCoords({
                                            easting: g.eastingStr || g.easting.toString(),
                                            northing: g.northingStr || g.northing.toString()
                                          })
                                        }}
                                        style={{
                                          padding: '4px 8px', borderRadius: '4px',
                                          background: 'rgba(0,0,0,0.2)',
                                          border: '1px solid rgba(255,255,255,0.1)',
                                          color: 'rgba(255,255,255,0.7)', fontSize: '11px',
                                          cursor: 'pointer', fontFamily: 'monospace',
                                          display: 'flex', alignItems: 'center', gap: '4px'
                                        }}
                                        title="Klicken zum Bearbeiten"
                                      >
                                        {g.label && <span style={{ color: '#f59e0b', fontWeight: 600 }}>{g.label.toUpperCase()}</span>}
                                        <span>{g.eastingStr || g.easting}/{g.northingStr || g.northing}</span>
                                        {g.altitude && <span style={{ color: 'rgba(255,255,255,0.4)' }}>{g.altitude}ft</span>}
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4 }}>
                                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Button zum Hinzufügen von Koordinaten - auch bei Tasks mit vorhandenen Goals */}
                          {!task.isCancelled && (
                            <div style={{ marginTop: '8px' }}>
                              {editingTaskNumber === task.taskNumber && editingGoalIndex === -1 ? (
                                // Eingabemodus für neue Koordinaten
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <input
                                    type="text"
                                    value={editCoords.easting}
                                    onChange={e => setEditCoords(prev => ({ ...prev, easting: e.target.value }))}
                                    placeholder="Easting"
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                      width: '60px', padding: '4px 6px',
                                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(59,130,246,0.5)',
                                      borderRadius: '4px', color: '#fff', fontSize: '11px'
                                    }}
                                  />
                                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>
                                  <input
                                    type="text"
                                    value={editCoords.northing}
                                    onChange={e => setEditCoords(prev => ({ ...prev, northing: e.target.value }))}
                                    placeholder="Northing"
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                      width: '60px', padding: '4px 6px',
                                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(59,130,246,0.5)',
                                      borderRadius: '4px', color: '#fff', fontSize: '11px'
                                    }}
                                  />
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      if (editCoords.easting && editCoords.northing) {
                                        const updatedTasks = parseResult.tasks.map(t => {
                                          if (t.taskNumber === task.taskNumber) {
                                            // Füge neue Koordinate zu bestehenden Goals hinzu
                                            const newGoal = {
                                              easting: parseInt(editCoords.easting),
                                              northing: parseInt(editCoords.northing),
                                              eastingStr: editCoords.easting,
                                              northingStr: editCoords.northing,
                                              label: String.fromCharCode(97 + t.goals.length) // a, b, c, ...
                                            }
                                            return {
                                              ...t,
                                              goals: [...t.goals, newGoal],
                                              needsUserInput: false
                                            }
                                          }
                                          return t
                                        })
                                        setParseResult({ ...parseResult, tasks: updatedTasks })
                                      }
                                      setEditingTaskNumber(null)
                                      setEditingGoalIndex(null)
                                    }}
                                    style={{
                                      padding: '4px 10px', background: '#22c55e', border: 'none',
                                      borderRadius: '4px', color: '#fff', fontSize: '10px', cursor: 'pointer'
                                    }}
                                  >
                                    Hinzufügen
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      setEditingTaskNumber(null)
                                      setEditingGoalIndex(null)
                                    }}
                                    style={{
                                      padding: '4px 8px', background: 'rgba(255,255,255,0.1)', border: 'none',
                                      borderRadius: '4px', color: 'rgba(255,255,255,0.6)', fontSize: '10px', cursor: 'pointer'
                                    }}
                                  >
                                    X
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={e => {
                                    e.stopPropagation()
                                    setEditingTaskNumber(task.taskNumber)
                                    setEditingGoalIndex(-1) // -1 = neue Koordinate
                                    setEditCoords({ easting: '', northing: '' })
                                  }}
                                  style={{
                                    padding: '4px 10px', borderRadius: '4px',
                                    background: task.goals.length === 0
                                      ? 'rgba(239, 68, 68, 0.1)'  // Rot wenn keine Goals
                                      : 'rgba(59, 130, 246, 0.1)',  // Blau wenn Goals vorhanden
                                    border: task.goals.length === 0
                                      ? '1px dashed rgba(239, 68, 68, 0.4)'
                                      : '1px dashed rgba(59, 130, 246, 0.4)',
                                    color: task.goals.length === 0 ? '#ef4444' : '#3b82f6',
                                    fontSize: '11px',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                  </svg>
                                  {task.goals.length === 0 ? 'Koordinate eingeben' : 'Weitere Koordinate'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>

        {/* Footer */}
        {importStep === 'configure' && parseResult?.success && (
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', gap: '12px', justifyContent: 'flex-end'
          }}>
            <button
              onClick={() => { setParseResult(null); setImportStep('select') }}
              style={{
                padding: '10px 20px',
                background: 'rgba(255,255,255,0.1)',
                border: 'none', borderRadius: '8px',
                color: '#fff', fontSize: '13px', cursor: 'pointer'
              }}
            >
              Zurück
            </button>
            <button
              onClick={startImport}
              disabled={selectedTasks.size === 0}
              style={{
                padding: '10px 24px',
                background: selectedTasks.size > 0
                  ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                  : 'rgba(255,255,255,0.1)',
                border: 'none', borderRadius: '8px',
                color: '#fff', fontSize: '13px', fontWeight: 600,
                cursor: selectedTasks.size > 0 ? 'pointer' : 'not-allowed',
                opacity: selectedTasks.size > 0 ? 1 : 0.5
              }}
            >
              {selectedTasks.size} Task{selectedTasks.size !== 1 ? 's' : ''} importieren
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
