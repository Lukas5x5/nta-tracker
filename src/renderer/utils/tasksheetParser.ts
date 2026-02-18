/**
 * Tasksheet Parser für Ballonwettbewerbe
 * Erkennt und extrahiert Task-Informationen aus PDF-Text
 *
 * Unterstützte Koordinaten-Formate:
 * - XXXX/YYYY (4-stellig)
 * - XXXXX/YYYY (5-stellig)
 * - XXXX/YYYY - XXXXft (mit Höhe)
 * - XXXX/YYYY - MMA XXm (mit MMA)
 * - XXX - XXXX/YYYY (mit Goal-ID)
 * - XXXX/YYYY - radius XXXm (mit Radius)
 */

export interface ParsedTask {
  taskNumber: number
  taskType: string  // PDG, FIN, HWZ, 3DT, JDG, FON, etc.
  taskName: string  // Regel-Name (z.B. "Selbst Gewähltes Ziel")
  goals: ParsedGoal[]
  mma: number  // 0 wenn nicht angegeben
  loggerMarker: number | null  // LM (Logger Marker)
  loggerGoal: number | null  // LG (Logger Goal)
  markerColor: string | null  // Primäre Marker-Farbe (Name, z.B. "yellow")
  markerColors?: string[]  // Alle Marker-Farben als Hex-Codes bei Multi-Marker (z.B. ["#eab308", "#3b82f6"])
  markerCount?: number  // Anzahl der Marker (1-3)
  markerDrop: string | null
  endTime: string | null  // z.B. "0830 loc."
  needsUserInput: boolean  // true wenn Koordinaten fehlen
  isCancelled?: boolean  // Task wurde storniert
  // Spezielle Felder für 3DT
  is3DT?: boolean
  innerRadius?: number  // in km
  outerRadius?: number  // in km
  // Spezielle Felder für APT (Altitude Profile Task)
  aptProfilePoints?: { timeMinutes: number; altitudeFt: number }[]
  aptLayerAFt?: number  // Layer A Toleranz in Feet
  aptLayerBFt?: number  // Layer B Toleranz in Feet
}

export interface ParsedGoal {
  easting: number  // 4-stellig oder 5-stellig
  northing: number
  // Ursprüngliche String-Werte für korrekte Padding-Behandlung (z.B. "0819" statt 819)
  eastingStr?: string
  northingStr?: string
  label?: string  // z.B. "a", "b", "c"
  goalId?: string  // z.B. "019" bei Creston-Format
  altitude?: number  // Höhe in ft wenn angegeben
  mma?: number  // MMA für dieses spezifische Goal
  radius?: number  // Radius in m für XDD Tasks
}

export interface TasksheetParseResult {
  success: boolean
  date: string | null
  flight: string | null  // z.B. "Flight 2", "AM", "PM"
  qnh: number | null
  startPeriodEnd: string | null
  tasks: ParsedTask[]
  errors: string[]
}

/**
 * Hilfsfunktion: Prüft ob eine Koordinate gültig ist
 * Unterstützt verschiedene UTM-Zonen und Koordinatenbereiche
 */
function isValidCoordinate(easting: number, northing: number): boolean {
  // 4-stellig: Verschiedene Bereiche je nach UTM-Zone
  // Europa (33U): Easting 1000-9999, Northing 4000-9999
  // Andere Zonen: Easting 0000-9999, Northing 0000-9999
  const isValid4Digit = easting >= 0 && easting <= 9999 && northing >= 0 && northing <= 9999
  // 5-stellig: Easting 00000-99999, Northing 00000-99999
  const isValid5Digit = easting >= 10000 && easting <= 99999 && northing >= 0 && northing <= 99999
  return isValid4Digit || isValid5Digit
}

/**
 * Hilfsfunktion: Erstellt ein ParsedGoal mit Original-Strings für korrekte Padding-Behandlung
 * z.B. "0819" wird als String gespeichert, damit die führende Null erhalten bleibt
 */
function createParsedGoal(eastingStr: string, northingStr: string, extras?: {
  goalId?: string
  altitude?: number
  mma?: number
  radius?: number
}): ParsedGoal {
  return {
    easting: parseInt(eastingStr),
    northing: parseInt(northingStr),
    eastingStr: eastingStr,
    northingStr: northingStr,
    ...extras
  }
}

/**
 * Extrahiert alle Koordinaten aus einem Text-Abschnitt mit verschiedenen Formaten
 * Gibt ein Array von ParsedGoals zurück
 *
 * Unterstützte Formate:
 * - "019 - 8572/4045 - MMA 100m" (Creston mit Goal-ID und MMA)
 * - "6847/2795 - MMA 50m" (WatchMeFly mit MMA nach Koordinate)
 * - "2995/0336 - radius 500m" (XDD mit Radius)
 * - "3222/0819 - 1755ft" (mit Höhe in ft)
 * - "1536 / 5517" (Standard ohne Zusatzinfo)
 */
function extractAllCoordinates(text: string): ParsedGoal[] {
  const coords: ParsedGoal[] = []
  const foundCoords = new Set<string>()

  let match

  // Pattern 1: Goal-ID + Koordinaten + MMA
  const pattern1 = /(\d{2,3})\s*[-–]\s*(\d{4,5})\s*\/\s*(\d{4,5})\s*[-–]\s*MMA\s*(\d+)\s*m/gi
  while ((match = pattern1.exec(text)) !== null) {
    const goalId = match[1]
    const eastingStr = match[2]
    const northingStr = match[3]
    const mma = parseInt(match[4])
    const key = `${eastingStr}/${northingStr}`
    if (!foundCoords.has(key) && isValidCoordinate(parseInt(eastingStr), parseInt(northingStr))) {
      foundCoords.add(key)
      coords.push(createParsedGoal(eastingStr, northingStr, { goalId, mma }))
    }
  }

  // Pattern 2: Koordinaten + MMA (ohne Goal-ID)
  const pattern2 = /(\d{4,5})\s*\/\s*(\d{4,5})\s*[-–]\s*MMA\s*(\d+)\s*m/gi
  while ((match = pattern2.exec(text)) !== null) {
    const eastingStr = match[1]
    const northingStr = match[2]
    const mma = parseInt(match[3])
    const key = `${eastingStr}/${northingStr}`
    if (!foundCoords.has(key) && isValidCoordinate(parseInt(eastingStr), parseInt(northingStr))) {
      foundCoords.add(key)
      coords.push(createParsedGoal(eastingStr, northingStr, { mma }))
    }
  }

  // Pattern 3: Koordinaten + Radius
  const pattern3 = /(\d{4,5})\s*\/\s*(\d{4,5})\s*[-–]\s*radius\s*(\d+)\s*m/gi
  while ((match = pattern3.exec(text)) !== null) {
    const eastingStr = match[1]
    const northingStr = match[2]
    const radius = parseInt(match[3])
    const key = `${eastingStr}/${northingStr}`
    if (!foundCoords.has(key) && isValidCoordinate(parseInt(eastingStr), parseInt(northingStr))) {
      foundCoords.add(key)
      coords.push(createParsedGoal(eastingStr, northingStr, { radius }))
    }
  }

  // Pattern 4: Koordinaten + Höhe in ft
  const pattern4 = /(\d{4,5})\s*\/\s*(\d{4,5})\s*[-–]\s*(\d+)\s*ft/gi
  while ((match = pattern4.exec(text)) !== null) {
    const eastingStr = match[1]
    const northingStr = match[2]
    const altitude = parseInt(match[3])
    const key = `${eastingStr}/${northingStr}`
    if (!foundCoords.has(key) && isValidCoordinate(parseInt(eastingStr), parseInt(northingStr))) {
      foundCoords.add(key)
      coords.push(createParsedGoal(eastingStr, northingStr, { altitude }))
    }
  }

  // Pattern 5: Standard-Koordinaten ohne Zusatzinfo
  const pattern5 = /(\d{4,5})\s*\/\s*(\d{4,5})/gi
  while ((match = pattern5.exec(text)) !== null) {
    const eastingStr = match[1]
    const northingStr = match[2]
    const key = `${eastingStr}/${northingStr}`
    if (!foundCoords.has(key) && isValidCoordinate(parseInt(eastingStr), parseInt(northingStr))) {
      foundCoords.add(key)
      coords.push(createParsedGoal(eastingStr, northingStr))
    }
  }

  return coords
}

/**
 * Parst den Text eines Tasksheets und extrahiert alle Tasks
 */
export function parseTasksheetText(text: string): TasksheetParseResult {
  const result: TasksheetParseResult = {
    success: false,
    date: null,
    flight: null,
    qnh: null,
    startPeriodEnd: null,
    tasks: [],
    errors: []
  }

  console.log('[Tasksheet Parser] Input text:', text)

  try {
    // Datum extrahieren (z.B. "05.04.2025" oder "11/09/2025")
    const dateMatch = text.match(/(\d{2}[.\/]\d{2}[.\/]\d{4})/);
    if (dateMatch) {
      result.date = dateMatch[1]
    }

    // Flight/Fahrt extrahieren (z.B. "Flight 2", "Fahrt 2", "AM", "PM")
    const flightMatch = text.match(/(?:Flight|Fahrt)\s*(\d+)/i) || text.match(/\b(AM|PM)\b/)
    if (flightMatch) {
      result.flight = flightMatch[0]
    }

    // QNH extrahieren
    const qnhMatch = text.match(/QNH\s*[:=]?\s*(\d{3,4})/i)
    if (qnhMatch) {
      result.qnh = parseInt(qnhMatch[1])
    }

    // Startperiode Ende extrahieren
    const startPeriodMatch = text.match(/Startperiode\s*(?:bis|endet)?\s*(\d{2}:\d{2})/i)
    if (startPeriodMatch) {
      result.startPeriodEnd = startPeriodMatch[1]
    }

    // Bekannte Task-Typen
    const validTaskTypes = ['PDG', 'JDG', 'HWZ', 'FIN', 'FON', 'HNH', 'WSD', 'GBM', 'CRT', 'RTA',
                           'ELB', 'LRN', 'MDT', 'MDD', 'XDI', 'XDT', 'XDD', 'ANG', 'SFL', '3DT', 'LTT', 'MTT', 'APT']

    // Tasks extrahieren - mehrere Patterns probieren
    // Speichere auch die Start-Position für jeden Task
    const taskPatterns = [
      // "Aufgabe 4 PDG" oder "Task 4 PDG" oder "Aufgabe 7 3DT"
      // Auch mit Bindestrich: "Task 1 - HWZ" oder "Task 2 - HWZ"
      /(?:Aufgabe|Task)\s*(\d{1,2})\s*[-–]?\s*(\d?[A-Z]{2,3})/gi,
      // "4. PDG" oder "4 PDG" (nur am Zeilenanfang oder nach Leerzeichen)
      /(?:^|\n)\s*(\d{1,2})\.?\s+(\d?[A-Z]{2,3})(?:\s|$)/gim,
    ]

    // Sammle alle Task-Matches mit Position
    interface TaskMatch {
      taskNumber: number
      taskType: string
      startIndex: number
    }
    const taskMatches: TaskMatch[] = []

    for (const taskPattern of taskPatterns) {
      let taskMatch
      taskPattern.lastIndex = 0

      while ((taskMatch = taskPattern.exec(text)) !== null) {
        const taskNumber = parseInt(taskMatch[1])
        const taskType = taskMatch[2].toUpperCase()

        // Nur gültige Task-Nummern (1-30) und bekannte Task-Typen
        if (taskNumber < 1 || taskNumber > 30) continue
        if (!validTaskTypes.includes(taskType)) continue

        // Prüfe ob diese Task-Nummer schon gefunden wurde
        if (!taskMatches.some(t => t.taskNumber === taskNumber)) {
          taskMatches.push({
            taskNumber,
            taskType,
            startIndex: taskMatch.index
          })
          console.log(`[Tasksheet Parser] Found task: ${taskNumber} ${taskType} at index ${taskMatch.index}`)
        }
      }
    }

    // Sortiere nach Position im Text
    taskMatches.sort((a, b) => a.startIndex - b.startIndex)

    // Parse jeden Task mit seinem Abschnitt
    for (let i = 0; i < taskMatches.length; i++) {
      const tm = taskMatches[i]
      const nextTm = taskMatches[i + 1]
      const endIndex = nextTm ? nextTm.startIndex : text.length
      const taskSection = text.substring(tm.startIndex, endIndex)

      const taskName = TASK_TYPE_NAMES[tm.taskType] || tm.taskType
      const task = parseIndividualTask(taskSection, tm.taskNumber, tm.taskType, taskName)
      result.tasks.push(task)
    }

    // Sortiere Tasks nach Nummer
    result.tasks.sort((a, b) => a.taskNumber - b.taskNumber)

    result.success = result.tasks.length > 0
    if (!result.success) {
      result.errors.push('Keine Tasks im Tasksheet gefunden. Bitte prüfe das Format.')
    }

    console.log('[Tasksheet Parser] Result:', result)

  } catch (err) {
    console.error('[Tasksheet Parser] Error:', err)
    result.errors.push(`Parser-Fehler: ${err}`)
  }

  return result
}

/**
 * Parst einen einzelnen Task aus dem bereits extrahierten Task-Abschnitt
 *
 * @param taskSection - Der Text-Abschnitt für diesen Task (bereits aus dem PDF extrahiert)
 * @param taskNumber - Die Task-Nummer
 * @param taskType - Der Task-Typ (z.B. "HWZ", "JDG", etc.)
 * @param taskName - Der Task-Name
 */
function parseIndividualTask(
  taskSection: string,
  taskNumber: number,
  taskType: string,
  taskName: string
): ParsedTask {
  const task: ParsedTask = {
    taskNumber,
    taskType,
    taskName,
    goals: [],
    mma: 0,
    loggerMarker: null,
    loggerGoal: null,
    markerColor: null,
    markerDrop: null,
    endTime: null,
    needsUserInput: false,
    isCancelled: false
  }

  console.log(`[parseIndividualTask] Task ${taskNumber} ${taskType}, section length: ${taskSection.length}`)
  console.log(`[parseIndividualTask] Task ${taskNumber} section preview:`, taskSection.substring(0, 300))

  // Prüfe ob Task storniert wurde
  if (/Task\s*Cancelled/i.test(taskSection) || /Aufgabe\s*(?:gestrichen|storniert)/i.test(taskSection)) {
    task.isCancelled = true
    console.log(`[parseIndividualTask] Task ${taskNumber} ist STORNIERT`)
  }

  // Verwende die neue universelle Koordinaten-Extraktion
  let coords = extractAllCoordinates(taskSection)

  // Task-typ-spezifische Nachbearbeitung
  if (taskType === 'FIN' || taskType === 'JDG' || taskType === 'GBM') {
    // Diese Tasks haben normalerweise nur ein Ziel - nimm das erste
    if (coords.length > 1) {
      coords = [coords[0]]
    }
  } else if (taskType === 'PDG' || taskType === 'FON') {
    // PDG und FON: Pilot deklariert selbst - keine vorgegebenen Koordinaten
    coords = []
  } else if (taskType === '3DT') {
    // 3DT: Keine Zielkoordinaten - Pilot deklariert den Mittelpunkt selbst
    task.is3DT = true
    coords = []

    // Extrahiere Radien
    const innerMatch = taskSection.match(/(?:inner\s*(?:circle)?|Innenkreis)[:\s]*(?:radius\s*)?(\d+)\s*km/i)
    if (innerMatch) {
      task.innerRadius = parseInt(innerMatch[1])
      console.log(`[parseIndividualTask] 3DT: Innenradius: ${task.innerRadius}km`)
    }

    const outerMatch = taskSection.match(/(?:outer\s*(?:circle)?|(?:Aussenkreis|Außenkreis))[:\s]*(?:radius\s*)?(\d+)\s*km/i)
    if (outerMatch) {
      task.outerRadius = parseInt(outerMatch[1])
      console.log(`[parseIndividualTask] 3DT: Außenradius: ${task.outerRadius}km`)
    }

    // Alternative: "R 1km" und "R 2km" Format
    if (!task.innerRadius || !task.outerRadius) {
      const radiiMatches = taskSection.match(/R\s*(\d+)\s*km/gi)
      if (radiiMatches && radiiMatches.length >= 2) {
        const radii = radiiMatches.map(m => parseInt(m.replace(/R\s*/i, '')))
        task.innerRadius = Math.min(...radii)
        task.outerRadius = Math.max(...radii)
        console.log(`[parseIndividualTask] 3DT: Radien aus R-Format: ${task.innerRadius}km / ${task.outerRadius}km`)
      }
    }
  } else if (taskType === 'APT') {
    // APT: Altitude Profile Task - Höhenprofil-Punkte und Layer-Toleranzen extrahieren
    coords = []  // APT hat keine Zielkoordinaten

    // Profil-Punkte extrahieren
    // Formate: "0 min 2500ft", "0min: 2500ft", "0' 2500ft", "2 min - 3000 ft", "0:00 2500ft"
    // Auch Tabellen-Format: Zeilen mit Zeit und Höhe
    const profilePoints: { timeMinutes: number; altitudeFt: number }[] = []

    // Pattern: "X min ... Yft" oder "X' ... Yft" oder "X:XX ... Yft"
    const profilePattern = /(\d+(?:[.:]\d+)?)\s*(?:min(?:utes?)?|'|m)\s*[-–:=]?\s*(\d+)\s*(?:ft|feet)/gi
    let profileMatch
    while ((profileMatch = profilePattern.exec(taskSection)) !== null) {
      const timeStr = profileMatch[1].replace(':', '.')
      const timeMin = parseFloat(timeStr)
      const altFt = parseInt(profileMatch[2])
      if (!isNaN(timeMin) && !isNaN(altFt) && altFt > 0) {
        profilePoints.push({ timeMinutes: timeMin, altitudeFt: altFt })
      }
    }

    // Alternative: Tabellen-Format "0 2500", "2 3000" (nur Zahlen, mind. 3 Zeilen)
    if (profilePoints.length < 2) {
      const lines = taskSection.split(/[\n\r]+/)
      const tablePoints: { timeMinutes: number; altitudeFt: number }[] = []
      for (const line of lines) {
        const tableMatch = line.trim().match(/^(\d+(?:\.\d+)?)\s+(\d{3,5})$/)
        if (tableMatch) {
          const timeMin = parseFloat(tableMatch[1])
          const altFt = parseInt(tableMatch[2])
          if (!isNaN(timeMin) && !isNaN(altFt) && altFt > 0) {
            tablePoints.push({ timeMinutes: timeMin, altitudeFt: altFt })
          }
        }
      }
      if (tablePoints.length >= 2) {
        profilePoints.push(...tablePoints)
      }
    }

    // Sortiere nach Zeit
    profilePoints.sort((a, b) => a.timeMinutes - b.timeMinutes)

    // Duplikate entfernen (gleiche Zeit)
    const uniquePoints: typeof profilePoints = []
    for (const p of profilePoints) {
      if (uniquePoints.length === 0 || uniquePoints[uniquePoints.length - 1].timeMinutes !== p.timeMinutes) {
        uniquePoints.push(p)
      }
    }

    if (uniquePoints.length >= 2) {
      task.aptProfilePoints = uniquePoints
      console.log(`[parseIndividualTask] APT: ${uniquePoints.length} Profil-Punkte gefunden:`,
        uniquePoints.map(p => `${p.timeMinutes}min=${p.altitudeFt}ft`).join(', '))
    }

    // Layer-Toleranzen extrahieren
    // "Layer A: 50ft", "Layer A ±50ft", "Layer A is Profile +/-50 feet",
    // "Layer A is Profile ± 50 feet", "Tolerance A: 50 ft", "Band A 50ft"
    const layerAMatch = taskSection.match(/(?:Layer|Tolerance|Band|Toleranz)\s*A\s*(?:is\s+(?:Profile\s+)?)?[:\s]*(?:\+\/?-|±)?\s*(\d+)\s*(?:ft|feet)/i)
    if (layerAMatch) {
      task.aptLayerAFt = parseInt(layerAMatch[1])
      console.log(`[parseIndividualTask] APT: Layer A = ±${task.aptLayerAFt}ft`)
    }

    const layerBMatch = taskSection.match(/(?:Layer|Tolerance|Band|Toleranz)\s*B\s*(?:is\s+(?:Profile\s+)?)?[:\s]*(?:\+\/?-|±)?\s*(\d+)\s*(?:ft|feet)/i)
    if (layerBMatch) {
      task.aptLayerBFt = parseInt(layerBMatch[1])
      console.log(`[parseIndividualTask] APT: Layer B = ±${task.aptLayerBFt}ft`)
    }

    // APT braucht keine Kartenposition - niemals needsUserInput setzen
    // Wenn keine Profilpunkte gefunden (z.B. nur Diagramm im PDF), werden Default-Punkte im APT-Panel verwendet
    // Layer-Werte werden trotzdem übernommen
    task.needsUserInput = false
  }

  // Log gefundene Koordinaten
  coords.forEach((c, i) => {
    console.log(`[parseIndividualTask] ${taskType} Koordinate ${i + 1}: ${c.eastingStr}/${c.northingStr}` +
      (c.altitude ? ` Alt:${c.altitude}ft` : '') +
      (c.mma ? ` MMA:${c.mma}m` : '') +
      (c.radius ? ` R:${c.radius}m` : '') +
      (c.goalId ? ` ID:${c.goalId}` : ''))
  })

  // Labels hinzufügen (a, b, c, ...)
  coords.forEach((coord, idx) => {
    coord.label = String.fromCharCode(97 + idx) // a, b, c, ...
  })
  task.goals = coords

  // MMA, Loggermarker etc. aus dem Task-Abschnitt extrahieren
  // MMA extrahieren - suche nach "MMA 75m", "MMA 50m", "R50m", "MMA R30m" etc.
  const mmaMatch = taskSection.match(/MMA\s*R?(\d+)\s*m?/i) || taskSection.match(/R(\d+)m/i)
  if (mmaMatch) {
    task.mma = parseInt(mmaMatch[1])
    console.log(`[parseIndividualTask] Task ${taskNumber}: MMA = ${task.mma}`)
  }

  // Loggermarker (LM) extrahieren - verschiedene Formate
  // "Loggermarker #1", "Loggermarker 1", "Logger Marker: #1"
  const loggerMatch = taskSection.match(/Logger\s*[Mm]arker[:\s]*#?(\d+)/i)
  if (loggerMatch) {
    task.loggerMarker = parseInt(loggerMatch[1])
    console.log(`[parseIndividualTask] Task ${taskNumber}: Loggermarker = ${task.loggerMarker}`)
  }

  // Logger Goal (LG) extrahieren - verschiedene Schreibweisen
  // "Logger Goal #1", "Loggerziel #1", "Logger Goal: #1"
  const lgMatch = taskSection.match(/Logger\s*Goal[:\s]*#?(\d+)/i) || taskSection.match(/Loggerziel[:\s]*#?(\d+)/i)
  if (lgMatch) {
    task.loggerGoal = parseInt(lgMatch[1])
    console.log(`[parseIndividualTask] Task ${taskNumber}: Logger Goal = ${task.loggerGoal}`)
  }

  // Marker Farbe extrahieren - deutsch und englisch
  // Unterstützt:
  // - Einzelne Farbe: "Marker Farbe weiss", "Marker color orange"
  // - Kombinierte Farben: "yellow/blue", "yellow/green", "yellow and blue"
  // - Multi-Marker: "Marker Color/s white and white"
  const colorPatterns = [
    /Marker\s*(?:Farbe|[Cc]olou?r)(?:\/s)?[:\s]+([a-zäöüß\/\s]+?)(?=\s*(?:Marker|MMA|Logger|Task|Scoring|$|\n))/i,
    /Marker\s*(?:Farbe|[Cc]olou?r)[:\s]+([a-zäöüß\/]+)/i
  ]
  for (const colorPattern of colorPatterns) {
    const colorMatch = taskSection.match(colorPattern)
    if (colorMatch && colorMatch[1] && colorMatch[1].trim() !== '-') {
      const rawColorStr = colorMatch[1].trim().toLowerCase()
      task.markerColor = rawColorStr

      // Prüfe ob mehrere Farben angegeben sind (z.B. "yellow/blue", "yellow and blue", "white and white")
      const colorParts = rawColorStr.split(/[\/,]|\s+and\s+/).map(c => c.trim()).filter(c => c && c !== 'and')

      if (colorParts.length > 1) {
        // Multi-Marker erkannt
        const hexColors: string[] = []
        for (const colorPart of colorParts) {
          const hex = colorNameToHex(colorPart)
          if (hex) {
            hexColors.push(hex)
          }
        }
        if (hexColors.length > 1) {
          task.markerColors = hexColors
          task.markerCount = hexColors.length
          console.log(`[parseIndividualTask] Task ${taskNumber}: Multi-Marker erkannt: ${hexColors.join(', ')}`)
        }
      }

      console.log(`[parseIndividualTask] Task ${taskNumber}: Marker Farbe = ${task.markerColor}`)
      break
    }
  }

  // Marker Drop extrahieren - deutsch und englisch
  // "Marker Drop frei", "Marker drop gravity", "Marker drop free"
  const dropMatch = taskSection.match(/Marker\s*[Dd]rop[:\s]*([a-zäöü]+)/i)
  if (dropMatch && dropMatch[1] !== '-') {
    task.markerDrop = dropMatch[1].toLowerCase()
    console.log(`[parseIndividualTask] Task ${taskNumber}: Marker Drop = ${task.markerDrop}`)
  }

  // Wertungsperiode/Scoring Period Ende extrahieren
  // "endet um 20:00 loc", "ends at 08:30:00", "Scoring Period End: 08:00"
  const endTimeMatch = taskSection.match(/(?:endet\s*(?:um)?|ends\s*at|Scoring\s*Period\s*End[:\s]*)\s*(\d{2}):?(\d{2})/i)
  if (endTimeMatch) {
    task.endTime = `${endTimeMatch[1]}:${endTimeMatch[2]}`
    console.log(`[parseIndividualTask] Task ${taskNumber}: End Time = ${task.endTime}`)
  }

  // Prüfen ob User-Input benötigt wird
  // PDG, FON, 3DT und andere ohne Koordinaten brauchen User-Input
  if (task.goals.length === 0 && !task.isCancelled) {
    task.needsUserInput = true
  }

  return task
}

/**
 * Konvertiert 4-stellige oder 5-stellige UTM-Koordinaten zu vollen Koordinaten
 * basierend auf der UTM-Zone und Base-Koordinaten aus den Settings
 *
 * WICHTIG: Verwendet die Original-Strings (eastingStr, northingStr) wenn verfügbar,
 * um führende Nullen korrekt zu behandeln (z.B. "0819" → "08190" statt "8190")
 *
 * Beispiel mit utmBaseEasting=517000, utmBaseNorthing=5346000:
 * - 4-stellig: 1716 / 5463 → "1716".padEnd(5,'0') = 17160 → 500000 + 17160 = 517160
 *                            "5463".padEnd(5,'0') = 54630 → 5300000 + 54630 = 5354630
 * - 4-stellig mit führender Null: 3222 / 0819 → "0819".padEnd(5,'0') = 08190 → 5300000 + 8190 = 5308190
 * - 5-stellig: 17160 / 54630 → direkt verwenden mit Base
 */
export function expandUTMCoordinates(
  easting: number,
  northing: number,
  utmBaseEasting: number = 500000,
  utmBaseNorthing: number = 5300000,
  eastingStr?: string,
  northingStr?: string,
  // NEU: Optionale Karten-Bounds für intelligente Quadrat-Auswahl (wie OZI Explorer)
  mapBounds?: { minE: number; maxE: number; minN: number; maxN: number }
): { easting: number; northing: number } {
  // Verwende Original-Strings wenn verfügbar, sonst Zahlen als String
  const eastStr = eastingStr || easting.toString()
  const northStr = northingStr || northing.toString()

  let fullEasting = easting
  let fullNorthing = northing

  // 4-stellige oder 5-stellige Koordinaten erweitern
  if (eastStr.length <= 4) {
    // Auf 5 Stellen erweitern: "1716" → "17160", "0819" → "08190"
    const eastMeters = parseInt(eastStr.padEnd(5, '0'))

    if (mapBounds) {
      // Intelligente Quadrat-Auswahl: Finde das Quadrat das in die Karten-Bounds passt
      const minQuadrant = Math.floor(mapBounds.minE / 100000) * 100000
      const maxQuadrant = Math.floor(mapBounds.maxE / 100000) * 100000

      if (minQuadrant === maxQuadrant) {
        // Karte liegt in einem Quadrat
        fullEasting = minQuadrant + eastMeters
      } else {
        // Karte überdeckt mehrere Quadrate - prüfe welches passt
        const candidateMin = minQuadrant + eastMeters
        const candidateMax = maxQuadrant + eastMeters

        if (candidateMin >= mapBounds.minE && candidateMin <= mapBounds.maxE) {
          fullEasting = candidateMin
        } else if (candidateMax >= mapBounds.minE && candidateMax <= mapBounds.maxE) {
          fullEasting = candidateMax
        } else {
          // Keins passt genau - nimm das nächste zum Kartenzentrum
          const mapCenterE = (mapBounds.minE + mapBounds.maxE) / 2
          fullEasting = Math.abs(candidateMin - mapCenterE) < Math.abs(candidateMax - mapCenterE)
            ? candidateMin : candidateMax
        }
      }
    } else {
      // Fallback: Verwende die übergebene Basis
      const gridSquareEastBase = Math.floor(utmBaseEasting / 100000) * 100000
      fullEasting = gridSquareEastBase + eastMeters
    }
  } else if (easting < 100000) {
    // 5-stellig aber < 100000
    const gridSquareEastBase = Math.floor(utmBaseEasting / 100000) * 100000
    fullEasting = gridSquareEastBase + easting
  }

  if (northStr.length <= 4) {
    // Auf 5 Stellen erweitern: "5463" → "54630", "0819" → "08190"
    const northMeters = parseInt(northStr.padEnd(5, '0'))

    if (mapBounds) {
      // Intelligente Quadrat-Auswahl für Northing
      const minQuadrant = Math.floor(mapBounds.minN / 100000) * 100000
      const maxQuadrant = Math.floor(mapBounds.maxN / 100000) * 100000

      if (minQuadrant === maxQuadrant) {
        // Karte liegt in einem Quadrat
        fullNorthing = minQuadrant + northMeters
      } else {
        // Karte überdeckt mehrere Quadrate - prüfe welches passt
        const candidateMin = minQuadrant + northMeters
        const candidateMax = maxQuadrant + northMeters

        if (candidateMin >= mapBounds.minN && candidateMin <= mapBounds.maxN) {
          fullNorthing = candidateMin
        } else if (candidateMax >= mapBounds.minN && candidateMax <= mapBounds.maxN) {
          fullNorthing = candidateMax
        } else {
          // Keins passt genau - nimm das nächste zum Kartenzentrum
          const mapCenterN = (mapBounds.minN + mapBounds.maxN) / 2
          fullNorthing = Math.abs(candidateMin - mapCenterN) < Math.abs(candidateMax - mapCenterN)
            ? candidateMin : candidateMax
        }
      }
    } else {
      // Fallback: Verwende die übergebene Basis
      const gridSquareNorthBase = Math.floor(utmBaseNorthing / 100000) * 100000
      fullNorthing = gridSquareNorthBase + northMeters
    }
  } else if (northing < 100000) {
    // 5-stellig aber < 100000
    const gridSquareNorthBase = Math.floor(utmBaseNorthing / 100000) * 100000
    fullNorthing = gridSquareNorthBase + northing
  }

  console.log('[expandUTMCoordinates]', {
    input: { easting, northing, eastingStr, northingStr },
    strings: { eastStr, northStr },
    base: { utmBaseEasting, utmBaseNorthing },
    mapBounds,
    result: { fullEasting, fullNorthing }
  })

  return { easting: fullEasting, northing: fullNorthing }
}

/**
 * Formatiert die Zeit von "0830" zu "08:30"
 */
export function formatTime(time: string): string {
  if (time.length === 4) {
    return `${time.substring(0, 2)}:${time.substring(2, 4)}`
  }
  return time
}

/**
 * Mappt Task-Typen zu deutschen Namen
 */
export const TASK_TYPE_NAMES: Record<string, string> = {
  'PDG': 'Pilot Declared Goal',
  'JDG': 'Judge Declared Goal',
  'HWZ': 'Hesitation Waltz',
  'FIN': 'Fly In',
  'FON': 'Fly On',
  '3DT': '3D Task',
  'CRT': 'Calculated Rate of Approach',
  'RTA': 'Race to an Area',
  'ELB': 'Elbow',
  'LRN': 'Land Run',
  'MDT': 'Minimum Distance',
  'MDD': 'Minimum Distance Double Drop',
  'XDI': 'Maximum Distance',
  'XDT': 'Maximum Distance Time',
  'XDD': 'Maximum Distance Double Drop',
  'SFL': 'Short Flight',
  'ANG': 'Angle',
  'GBM': 'Gordon Bennett Memorial',
  'LTT': 'Least Time Task',
  'MTT': 'Most Time Task',
  'APT': 'Altitude Profile Task'
}

/**
 * Mappt Marker-Farben zu Hex-Codes
 * Unterstützt deutsch, englisch und kombinierte Farben (z.B. "yellow/blue")
 */
export const MARKER_COLORS: Record<string, string> = {
  // Rosa/Pink
  'pink': '#ec4899',
  'rosa': '#ec4899',
  // Blau
  'hellblau': '#38bdf8',
  'light blue': '#38bdf8',
  'lightblue': '#38bdf8',
  'blau': '#3b82f6',
  'blue': '#3b82f6',
  // Rot
  'rot': '#ef4444',
  'red': '#ef4444',
  // Gelb
  'gelb': '#eab308',
  'yellow': '#eab308',
  // Grün
  'grün': '#22c55e',
  'gruen': '#22c55e',
  'green': '#22c55e',
  // Orange
  'orange': '#f97316',
  // Weiß
  'weiss': '#ffffff',
  'weiß': '#ffffff',
  'white': '#ffffff',
  // Schwarz
  'schwarz': '#000000',
  'black': '#000000',
  // Lila/Violett
  'lila': '#a855f7',
  'violett': '#a855f7',
  'purple': '#a855f7',
  // Türkis/Cyan
  'türkis': '#14b8a6',
  'tuerkis': '#14b8a6',
  'cyan': '#06b6d4',
  // Grau
  'grau': '#6b7280',
  'grey': '#6b7280',
  'gray': '#6b7280'
}

/**
 * Konvertiert einen Farbnamen (oder kombinierte Farben wie "yellow/blue") zu Hex-Code
 * Gibt die erste erkannte Farbe zurück
 */
export function colorNameToHex(colorName: string | null | undefined): string | null {
  if (!colorName) return null

  const normalized = colorName.toLowerCase().trim()

  // Direkte Übereinstimmung
  if (MARKER_COLORS[normalized]) {
    return MARKER_COLORS[normalized]
  }

  // Bei kombinierten Farben (z.B. "yellow/blue") - nimm die erste
  const parts = normalized.split(/[\/,\-]/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (MARKER_COLORS[trimmed]) {
      return MARKER_COLORS[trimmed]
    }
  }

  return null
}
