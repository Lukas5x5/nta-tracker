/**
 * KI-basierter Tasksheet-Parser
 * Nutzt Google Gemini Flash (kostenlos) um Tasksheet-Text intelligent zu analysieren.
 * Erkennt alle Formate (deutsch, englisch, beliebige Layouts).
 */

import { ParsedTask, ParsedGoal, TasksheetParseResult } from './tasksheetParser'

// Gemini API Key (kostenlos)
const GEMINI_API_KEY = 'AIzaSyArdTW5_v_NPssUHwtI3-a5m4wSSZflB-Y'

const SYSTEM_PROMPT = `Du extrahierst Tasks aus Ballonwettbewerb-Tasksheets als JSON. Hier ein Beispiel:

INPUT:
Fahrt 1 01.03.2024 QNH 1006
Aufgabe 1 – DREIECKSFLÄCHE (LRN) Loggermarker #1 #2 #3 Wertungsperiode bis 12:30
Aufgabe 2 – QUAL DER WAHL (HWZ) a. Position 5395 1791 / 5455 1877 MMA R50m Loggermarker #4 Markerfarbe hellblau Absetzen fallenlassen Wertungsperiode bis 13:00
Aufgabe 3 – FLY ON (FON) Loggergoal #1 Minimale Distanz ≥1 km Loggermarker #6 Wertungsperiode bis 14:00
Aufgabe 4 – 3D-AUFGABE (3DT) Innenradius 1,5 km Außenradius 2 km Loggergoal #2 Wertungsperiode bis 14:00
Aufgabe 5 – XDT Loggermarker #5 Wertungsperiode bis 14:00

OUTPUT:
{"date":"01.03.2024","flight":"Fahrt 1","qnh":1006,"tasks":[
{"taskNumber":1,"taskType":"LRN","goals":[],"mma":0,"rings":[],"loggerMarker":1,"loggerGoal":null,"markerColor":null,"markerDrop":null,"endTime":"12:30","needsUserInput":true},
{"taskNumber":2,"taskType":"HWZ","goals":[{"eastingStr":"5395","northingStr":"1791"},{"eastingStr":"5455","northingStr":"1877"}],"mma":50,"rings":[],"loggerMarker":4,"loggerGoal":null,"markerColor":"lightblue","markerDrop":"gravity","endTime":"13:00","needsUserInput":false},
{"taskNumber":3,"taskType":"FON","goals":[],"mma":0,"rings":[1000],"loggerMarker":6,"loggerGoal":1,"markerColor":null,"markerDrop":null,"endTime":"14:00","needsUserInput":true},
{"taskNumber":4,"taskType":"3DT","goals":[],"mma":0,"rings":[1500,2000],"loggerMarker":null,"loggerGoal":2,"markerColor":null,"markerDrop":null,"endTime":"14:00","needsUserInput":true},
{"taskNumber":5,"taskType":"XDT","goals":[],"mma":0,"rings":[],"loggerMarker":5,"loggerGoal":null,"markerColor":null,"markerDrop":null,"endTime":"14:00","needsUserInput":true}
]}

REGELN:
- taskType: Verwende den 2-3 Buchstaben Code (PDG, JDG, HWZ, FIN, FON, HNH, WSD, GBM, CRT, RTA, ELB, LRN, MDT, MDD, XDI, XDT, XDD, ANG, SFL, LTT, MTT, APT, 3DT). Steht oft in Klammern.
- goals: UTM-Koordinaten als Strings. "5395 1791" → eastingStr:"5395", northingStr:"1791". Auch "5395/1791". Leeres Array wenn keine Koordinaten.
- mma: MMA Radius in Metern. "R50m" oder "MMA 50m" → 50. MMA ist KEIN Ring!
- rings: Distanz-Kreise in METERN. Konvertiere km→m: 1km=1000, 1.5km=1500, 2km=2000. Beispiele:
  * "Innenradius 1,5 km, Außenradius 2 km" → [1500, 2000]
  * "radius 2km" → [2000]
  * "≥1 km" oder "min 1km" bei Distanz → [1000]
  * "minimum 1km maximum 3km" → [1000, 3000]
  * NICHT MMA hier eintragen!
- loggerMarker: Erste LM Nummer. "#1 #2 #3" → 1. "LM #7" → 7.
- loggerGoal: "Loggergoal #1" → 1. null wenn nicht vorhanden.
- markerColor: Englisch. hellblau→lightblue, gelb→yellow, rot→red, grün→green, blau→blue, weiß→white
- markerDrop: "fallenlassen"→"gravity", "frei"→"free"
- endTime: "HH:MM". "bis 13:00" → "13:00". "ends at 0830" → "08:30"
- needsUserInput: true wenn goals leer (Pilot muss Koordinaten selbst eingeben)
- "Aufgabe" = "Task"

Antworte NUR mit JSON, KEIN anderer Text.`

/**
 * KI-basierter Tasksheet-Parser mit Google Gemini Flash (kostenlos)
 * Kann Text oder PDF-Base64 direkt analysieren.
 */
export async function parseTasksheetWithAI(text: string, pdfBase64?: string): Promise<TasksheetParseResult | null> {
  try {
    // Inhalt vorbereiten: PDF direkt oder Text
    const parts: any[] = []
    if (pdfBase64) {
      console.log('[AI-Parser] Sende PDF direkt an Gemini API...')
      parts.push({
        inline_data: {
          mime_type: 'application/pdf',
          data: pdfBase64
        }
      })
      parts.push({ text: 'Analysiere dieses Tasksheet-PDF und extrahiere alle Tasks als JSON.' })
    } else {
      console.log('[AI-Parser] Sende Text an Gemini API...')
      parts.push({ text: `Analysiere dieses Tasksheet:\n\n${text}` })
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[AI-Parser] Gemini API Fehler:', response.status, errorText)
      return null
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      console.error('[AI-Parser] Keine Antwort von Gemini')
      return null
    }

    console.log('[AI-Parser] Gemini Antwort:', content.substring(0, 500))

    // JSON aus der Antwort extrahieren (Claude könnte es in Markdown-Codeblöcke wrappen)
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }

    const parsed = JSON.parse(jsonStr.trim())
    console.log('[AI-Parser] Parsed JSON:', JSON.stringify(parsed, null, 2))

    // In TasksheetParseResult konvertieren
    const tasks: ParsedTask[] = (parsed.tasks || []).map((t: any) => {
      console.log(`[AI-Parser] Task ${t.taskNumber} ${t.taskType}: goals=${JSON.stringify(t.goals)}, rings=${JSON.stringify(t.rings)}, needsUserInput=${t.needsUserInput}`)
      return {
      taskNumber: t.taskNumber,
      taskType: t.taskType,
      taskName: '',
      goals: (t.goals || []).map((g: any) => ({
        easting: parseInt(g.eastingStr || '0'),
        northing: parseInt(g.northingStr || '0'),
        eastingStr: g.eastingStr,
        northingStr: g.northingStr,
        label: g.label || undefined
      } as ParsedGoal)),
      mma: t.mma || 0,
      rings: t.rings && t.rings.length > 0 ? t.rings : undefined,
      loggerMarker: t.loggerMarker || null,
      loggerGoal: t.loggerGoal || null,
      markerColor: t.markerColor || null,
      markerColors: undefined,
      markerCount: undefined,
      markerDrop: t.markerDrop || null,
      endTime: t.endTime || null,
      needsUserInput: t.needsUserInput ?? (t.goals?.length === 0),
      isCancelled: false
    }})

    console.log(`[AI-Parser] ${tasks.length} Tasks erkannt`)

    return {
      success: true,
      date: parsed.date || null,
      flight: parsed.flight || null,
      qnh: parsed.qnh || null,
      startPeriodEnd: null,
      tasks,
      errors: []
    }
  } catch (err: any) {
    console.error('[AI-Parser] Fehler:', err.message)
    return null
  }
}
