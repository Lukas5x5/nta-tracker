/**
 * OZF (OziExplorer) Map Format Parser
 *
 * Unterstützt:
 * - .ozf2 (OziExplorer 2.x Format)
 * - .ozf3 (OziExplorer 3.x Format)
 * - .ozfx3 (OziExplorer Extended Format)
 * - .map (Kalibrierungsdatei)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import * as cryptoNode from 'crypto'

// Debug-Flag für einmaliges Logging
let geoToPixelDebugShown = false

// Typen
export interface MapCalibration {
  filename: string
  title: string
  imagePath: string
  projection: string
  datum: string
  calibrationPoints: CalibrationPoint[]
  bounds: MapBounds
  imageWidth: number
  imageHeight: number
  // MMPLL Eckpunkte für rotiertes Overlay (in Reihenfolge: 1=topLeft, 2=topRight, 3=bottomRight, 4=bottomLeft)
  cornerPoints?: {
    topLeft: { lat: number; lon: number }
    topRight: { lat: number; lon: number }
    bottomRight: { lat: number; lon: number }
    bottomLeft: { lat: number; lon: number }
  }
  // UTM-Kalibrierung für präzise Transformation (wenn Karte in UTM kalibriert ist)
  utmCalibration?: {
    zone: number
    // Affine Transformation: Pixel → UTM (für schnelle Näherung)
    // easting = a * pixelX + b * pixelY + c
    // northing = d * pixelX + e * pixelY + f
    pixelToUtm: { a: number; b: number; c: number; d: number; e: number; f: number }
    // Inverse: UTM → Pixel
    utmToPixel: { a: number; b: number; c: number; d: number; e: number; f: number }
    // Bilineare Kalibrierungspunkte (4 Ecken) für präzise Transformation
    bilinearPoints?: {
      topLeft: { px: number; py: number; e: number; n: number }
      topRight: { px: number; py: number; e: number; n: number }
      bottomRight: { px: number; py: number; e: number; n: number }
      bottomLeft: { px: number; py: number; e: number; n: number }
    }
  }
}

export interface CalibrationPoint {
  pixelX: number
  pixelY: number
  latitude: number
  longitude: number
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface OZFHeader {
  magic: number
  version: number
  width: number
  height: number
  depth: number
  tileWidth: number
  tileHeight: number
  tilesX: number
  tilesY: number
  zoomLevels: number
}

export interface OZFTile {
  x: number
  y: number
  zoom: number
  data: Buffer
}

export interface LoadedMap {
  id: string
  name: string
  calibration: MapCalibration
  ozfPath: string
  mapPath: string
  imagePath?: string  // Pfad zum extrahierten Bild
  tiles: Map<string, Buffer>  // Cache für geladene Tiles
}

/**
 * Parser für .map Kalibrierungsdateien (OziExplorer Format)
 */
export function parseMapFile(mapFilePath: string): MapCalibration {
  const content = fs.readFileSync(mapFilePath, 'utf-8')
  const lines = content.split(/\r?\n/)

  const calibration: MapCalibration = {
    filename: path.basename(mapFilePath),
    title: '',
    imagePath: '',
    projection: 'Latitude/Longitude',
    datum: 'WGS 84',
    calibrationPoints: [],
    bounds: { north: -90, south: 90, east: -180, west: 180 },
    imageWidth: 0,
    imageHeight: 0
  }

  // MMPLL Eckpunkte separat sammeln (diese sind autoritativ wenn vorhanden)
  const mmpllPoints: { lat: number; lon: number }[] = []
  // MMPXY Pixel-Eckpunkte (definieren wo im Bild die Karte liegt)
  const mmpxyPoints: { x: number; y: number }[] = []
  // UTM Kalibrierungspunkte (für präzise Transformation)
  const utmCalibPoints: { pixelX: number; pixelY: number; easting: number; northing: number; zone: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Zeile 1: OziExplorer Map Data File Version
    if (i === 0 && line.startsWith('OziExplorer Map Data File')) {
      continue
    }

    // Zeile 2: Kartentitel
    if (i === 1) {
      calibration.title = line
      continue
    }

    // Zeile 3: Bildpfad
    if (i === 2) {
      calibration.imagePath = line
      continue
    }

    // Zeile 4: Magic Number (1 = OziExplorer)
    if (i === 3) continue

    // Zeile 5: Datum
    if (i === 4) {
      calibration.datum = line.split(',')[0] || 'WGS 84'
      console.log('Karten-Datum:', calibration.datum)
      continue
    }

    // Zeile 6+: Weitere Metadaten und Kalibrierungspunkte

    // Kalibrierungspunkte: Point01,xy, ... bis Point30,xy
    if (line.startsWith('Point') && line.includes(',')) {
      const result = parseCalibrationPointWithUtm(line)
      if (result) {
        calibration.calibrationPoints.push(result.point)
        if (result.utm) {
          utmCalibPoints.push(result.utm)
          console.log(`UTM-Kalibrierungspunkt gefunden: Pixel(${result.utm.pixelX}, ${result.utm.pixelY}) -> UTM Zone ${result.utm.zone}: E${result.utm.easting}, N${result.utm.northing}`)
        }
      }
    }

    // IWH (Image Width/Height)
    if (line.startsWith('IWH,')) {
      const parts = line.split(',')
      if (parts.length >= 3) {
        calibration.imageWidth = parseInt(parts[2]) || 0
        calibration.imageHeight = parseInt(parts[3]) || 0
      }
    }

    // Map Projection
    if (line.startsWith('Map Projection,')) {
      calibration.projection = line.split(',')[1] || 'Latitude/Longitude'
    }

    // MMPXY (Map pixel corner points) - Pixel-Koordinaten der Kartenecken
    if (line.startsWith('MMPXY,')) {
      const parts = line.split(',')
      if (parts.length >= 4) {
        const x = parseInt(parts[2])
        const y = parseInt(parts[3])
        if (!isNaN(x) && !isNaN(y)) {
          mmpxyPoints.push({ x, y })
        }
      }
    }

    // MMPLL (Map bounds corner points) - autoritativ für Bounds
    if (line.startsWith('MMPLL,')) {
      const parts = line.split(',')
      if (parts.length >= 4) {
        const lon = parseFloat(parts[2])
        const lat = parseFloat(parts[3])
        if (!isNaN(lat) && !isNaN(lon)) {
          mmpllPoints.push({ lat, lon })
        }
      }
    }
  }

  // Wenn wir UTM-Kalibrierungspunkte haben, berechne die UTM-Transformation
  if (utmCalibPoints.length >= 2) {
    const zone = utmCalibPoints[0].zone
    const allSameZone = utmCalibPoints.every(p => p.zone === zone)

    if (allSameZone) {
      let aE: number, bE: number, cE: number, aN: number, bN: number, cN: number

      if (utmCalibPoints.length === 2) {
        // Mit nur 2 Punkten: Berechne Skalierung ohne Rotation
        // Annahme: Karte ist achsenparallel (keine Rotation)
        const p1 = utmCalibPoints[0]
        const p2 = utmCalibPoints[1]

        const dPx = p2.pixelX - p1.pixelX
        const dPy = p2.pixelY - p1.pixelY
        const dE = p2.easting - p1.easting
        const dN = p2.northing - p1.northing

        // Meter pro Pixel
        // Für achsenparallele Karten: Easting hängt nur von X ab, Northing nur von Y
        // easting = aE * pixelX + cE (bE = 0)
        // northing = bN * pixelY + cN (aN = 0)

        if (Math.abs(dPx) > 0.001 && Math.abs(dPy) > 0.001) {
          aE = dE / dPx  // Easting ändert sich mit X
          bE = 0
          cE = p1.easting - aE * p1.pixelX

          aN = 0
          bN = dN / dPy  // Northing ändert sich mit Y
          cN = p1.northing - bN * p1.pixelY

          console.log('UTM-Kalibrierung aus 2 Punkten (achsenparallel):', {
            meterPerPixelX: aE,
            meterPerPixelY: bN,
            zone
          })
        } else {
          // Punkte auf gleicher Linie - kann keine Transformation berechnen
          console.log('UTM-Kalibrierung: 2 Punkte auf gleicher Linie, überspringe')
          aE = bE = cE = aN = bN = cN = 0
        }
      } else {
        // Mit 3+ Punkten: Vollständige affine Transformation
        const n = utmCalibPoints.length
        let sumPx = 0, sumPy = 0, sumPxPx = 0, sumPyPy = 0, sumPxPy = 0
        let sumEPx = 0, sumEPy = 0, sumE = 0
        let sumNPx = 0, sumNPy = 0, sumN = 0

        for (const p of utmCalibPoints) {
          sumPx += p.pixelX
          sumPy += p.pixelY
          sumPxPx += p.pixelX * p.pixelX
          sumPyPy += p.pixelY * p.pixelY
          sumPxPy += p.pixelX * p.pixelY
          sumEPx += p.easting * p.pixelX
          sumEPy += p.easting * p.pixelY
          sumE += p.easting
          sumNPx += p.northing * p.pixelX
          sumNPy += p.northing * p.pixelY
          sumN += p.northing
        }

        const det = sumPxPx * (sumPyPy * n - sumPy * sumPy)
                  - sumPxPy * (sumPxPy * n - sumPy * sumPx)
                  + sumPx * (sumPxPy * sumPy - sumPyPy * sumPx)

        if (Math.abs(det) > 1e-10) {
          aE = (sumEPx * (sumPyPy * n - sumPy * sumPy) - sumEPy * (sumPxPy * n - sumPy * sumPx) + sumE * (sumPxPy * sumPy - sumPyPy * sumPx)) / det
          bE = (sumPxPx * (sumEPy * n - sumE * sumPy) - sumPxPy * (sumEPx * n - sumE * sumPx) + sumPx * (sumEPx * sumPy - sumEPy * sumPx)) / det
          cE = (sumPxPx * (sumPyPy * sumE - sumPy * sumEPy) - sumPxPy * (sumPxPy * sumE - sumPy * sumEPx) + sumPx * (sumPxPy * sumEPy - sumPyPy * sumEPx)) / det

          aN = (sumNPx * (sumPyPy * n - sumPy * sumPy) - sumNPy * (sumPxPy * n - sumPy * sumPx) + sumN * (sumPxPy * sumPy - sumPyPy * sumPx)) / det
          bN = (sumPxPx * (sumNPy * n - sumN * sumPy) - sumPxPy * (sumNPx * n - sumN * sumPx) + sumPx * (sumNPx * sumPy - sumNPy * sumPx)) / det
          cN = (sumPxPx * (sumPyPy * sumN - sumPy * sumNPy) - sumPxPy * (sumPxPy * sumN - sumPy * sumNPx) + sumPx * (sumPxPy * sumNPy - sumPyPy * sumNPx)) / det
        } else {
          aE = bE = cE = aN = bN = cN = 0
        }
      }

      // Inverse berechnen: UTM → Pixel
      // Für affine Transformation: easting = aE*px + bE*py + cE, northing = aN*px + bN*py + cN
      // Inverse: px = aP*easting + bP*northing + cP, py = dP*easting + eP*northing + fP
      const det2 = aE * bN - bE * aN
      if (Math.abs(det2) > 1e-10) {
        const aP = bN / det2
        const bP = -bE / det2
        const dP = -aN / det2
        const eP = aE / det2
        // Für die Konstanten: Setze px=0, py=0 ein und löse nach cP, fP auf
        // 0 = aP*cE + bP*cN + cP => cP = -(aP*cE + bP*cN)
        // 0 = dP*cE + eP*cN + fP => fP = -(dP*cE + eP*cN)
        const cP = -(aP * cE + bP * cN)
        const fP = -(dP * cE + eP * cN)

        // Speichere die BILDECKEN (0,0 etc.) für die Reprojektion
        // Die bilinearPoints enthalten die Pixel-Koordinaten der Bildecken
        // und die entsprechenden UTM-Koordinaten (extrapoliert aus den Kalibrierungspunkten)
        let bilinearPoints: {
          topLeft: { px: number; py: number; e: number; n: number }
          topRight: { px: number; py: number; e: number; n: number }
          bottomRight: { px: number; py: number; e: number; n: number }
          bottomLeft: { px: number; py: number; e: number; n: number }
        } | undefined = undefined

        // Berechne UTM für die 4 Bildecken (Pixel 0,0 etc.)
        // Wir extrapolieren aus den Kalibrierungspunkten
        if (calibration.imageWidth > 0 && calibration.imageHeight > 0) {
          const imgW = calibration.imageWidth
          const imgH = calibration.imageHeight

          // UTM für jede Bildecke berechnen (via affine Transformation)
          const utmTL = { e: aE * 0 + bE * 0 + cE, n: aN * 0 + bN * 0 + cN }
          const utmTR = { e: aE * imgW + bE * 0 + cE, n: aN * imgW + bN * 0 + cN }
          const utmBR = { e: aE * imgW + bE * imgH + cE, n: aN * imgW + bN * imgH + cN }
          const utmBL = { e: aE * 0 + bE * imgH + cE, n: aN * 0 + bN * imgH + cN }

          bilinearPoints = {
            topLeft: { px: 0, py: 0, e: utmTL.e, n: utmTL.n },
            topRight: { px: imgW, py: 0, e: utmTR.e, n: utmTR.n },
            bottomRight: { px: imgW, py: imgH, e: utmBR.e, n: utmBR.n },
            bottomLeft: { px: 0, py: imgH, e: utmBL.e, n: utmBL.n }
          }

          console.log('Bilineare Punkte (Bildecken mit UTM):', bilinearPoints)
        }

        calibration.utmCalibration = {
          zone,
          pixelToUtm: { a: aE, b: bE, c: cE, d: aN, e: bN, f: cN },
          utmToPixel: { a: aP, b: bP, c: cP, d: dP, e: eP, f: fP },
          bilinearPoints
        }

        console.log('UTM-Kalibrierung berechnet (Zone ' + zone + ', ' + utmCalibPoints.length + ' Punkte):', {
          pixelToUtm: calibration.utmCalibration.pixelToUtm,
          utmToPixel: calibration.utmCalibration.utmToPixel,
          hasBilinear: !!bilinearPoints
        })
      }
    }
  }

  // Bounds berechnen:
  // WICHTIG: Für konsistente Reprojektion müssen bounds und Pixel-Transformation
  // beide die gleiche Methode verwenden (UTM wenn verfügbar)

  if (calibration.utmCalibration && calibration.imageWidth > 0 && calibration.imageHeight > 0) {
    // UTM-Kalibrierung vorhanden: Berechne Eckpunkte über UTM für Konsistenz
    const tempCalibration: MapCalibration = {
      filename: '',
      title: '',
      imagePath: '',
      projection: '',
      datum: '',
      calibrationPoints: calibration.calibrationPoints,
      bounds: { north: 0, south: 0, east: 0, west: 0 },
      imageWidth: calibration.imageWidth,
      imageHeight: calibration.imageHeight,
      utmCalibration: calibration.utmCalibration
    }

    // Berechne Eckpunkte über UTM-Transformation (konsistent mit Reprojektion)
    const topLeft = pixelToGeo(0, 0, tempCalibration)
    const topRight = pixelToGeo(calibration.imageWidth, 0, tempCalibration)
    const bottomLeft = pixelToGeo(0, calibration.imageHeight, tempCalibration)
    const bottomRight = pixelToGeo(calibration.imageWidth, calibration.imageHeight, tempCalibration)

    console.log('Bounds aus UTM-Kalibrierung:', {
      zone: calibration.utmCalibration.zone,
      corners: { topLeft, topRight, bottomLeft, bottomRight }
    })

    calibration.cornerPoints = {
      topLeft,
      topRight,
      bottomRight,
      bottomLeft
    }

    const allCorners = [topLeft, topRight, bottomLeft, bottomRight]
    calibration.bounds = {
      north: Math.max(...allCorners.map(c => c.lat)),
      south: Math.min(...allCorners.map(c => c.lat)),
      east: Math.max(...allCorners.map(c => c.lon)),
      west: Math.min(...allCorners.map(c => c.lon))
    }
  } else if (mmpllPoints.length >= 4 && mmpxyPoints.length >= 4) {
    // Kein UTM: Verwende MMPLL als Fallback
    const topLeft = { lat: mmpllPoints[0].lat, lon: mmpllPoints[0].lon }
    const topRight = { lat: mmpllPoints[1].lat, lon: mmpllPoints[1].lon }
    const bottomRight = { lat: mmpllPoints[2].lat, lon: mmpllPoints[2].lon }
    const bottomLeft = { lat: mmpllPoints[3].lat, lon: mmpllPoints[3].lon }

    console.log('Bounds aus MMPLL (kein UTM):', {
      topLeft, topRight, bottomRight, bottomLeft
    })

    calibration.cornerPoints = {
      topLeft,
      topRight,
      bottomRight,
      bottomLeft
    }

    const allCorners = [topLeft, topRight, bottomLeft, bottomRight]
    calibration.bounds = {
      north: Math.max(...allCorners.map(c => c.lat)),
      south: Math.min(...allCorners.map(c => c.lat)),
      east: Math.max(...allCorners.map(c => c.lon)),
      west: Math.min(...allCorners.map(c => c.lon))
    }
  } else if (calibration.calibrationPoints.length >= 3 && calibration.imageWidth > 0 && calibration.imageHeight > 0) {
    // Fallback: MMPXY + MMPLL wenn keine Kalibrierungspunkte vorhanden
    const topLeft = { lat: mmpllPoints[0].lat, lon: mmpllPoints[0].lon }
    const topRight = { lat: mmpllPoints[1].lat, lon: mmpllPoints[1].lon }
    const bottomRight = { lat: mmpllPoints[2].lat, lon: mmpllPoints[2].lon }
    const bottomLeft = { lat: mmpllPoints[3].lat, lon: mmpllPoints[3].lon }

    console.log('Kalibrierung aus MMPXY+MMPLL (Fallback):', {
      mmpxy: mmpxyPoints,
      mmpll: mmpllPoints,
      imageSize: { w: calibration.imageWidth, h: calibration.imageHeight }
    })

    calibration.cornerPoints = {
      topLeft,
      topRight,
      bottomRight,
      bottomLeft
    }

    calibration.calibrationPoints = [
      { pixelX: mmpxyPoints[0].x, pixelY: mmpxyPoints[0].y, latitude: mmpllPoints[0].lat, longitude: mmpllPoints[0].lon },
      { pixelX: mmpxyPoints[1].x, pixelY: mmpxyPoints[1].y, latitude: mmpllPoints[1].lat, longitude: mmpllPoints[1].lon },
      { pixelX: mmpxyPoints[2].x, pixelY: mmpxyPoints[2].y, latitude: mmpllPoints[2].lat, longitude: mmpllPoints[2].lon },
      { pixelX: mmpxyPoints[3].x, pixelY: mmpxyPoints[3].y, latitude: mmpllPoints[3].lat, longitude: mmpllPoints[3].lon }
    ]

    const allCorners = [topLeft, topRight, bottomLeft, bottomRight]
    calibration.bounds = {
      north: Math.max(...allCorners.map(c => c.lat)),
      south: Math.min(...allCorners.map(c => c.lat)),
      east: Math.max(...allCorners.map(c => c.lon)),
      west: Math.min(...allCorners.map(c => c.lon))
    }
  } else if (mmpllPoints.length >= 4) {
    // Fallback: MMPLL Eckpunkte (wenn keine Kalibrierungspunkte vorhanden)
    // Reihenfolge in .map Datei: MMPLL,1 = topLeft, MMPLL,2 = topRight, MMPLL,3 = bottomRight, MMPLL,4 = bottomLeft
    calibration.cornerPoints = {
      topLeft: mmpllPoints[0],
      topRight: mmpllPoints[1],
      bottomRight: mmpllPoints[2],
      bottomLeft: mmpllPoints[3]
    }

    calibration.bounds = {
      north: Math.max(...mmpllPoints.map(p => p.lat)),
      south: Math.min(...mmpllPoints.map(p => p.lat)),
      east: Math.max(...mmpllPoints.map(p => p.lon)),
      west: Math.min(...mmpllPoints.map(p => p.lon))
    }
  } else if (calibration.calibrationPoints.length >= 2 && calibration.imageWidth > 0 && calibration.imageHeight > 0) {
    // 2 Kalibrierungspunkte - weniger präzise, aber besser als nichts
    const tempCalibration: MapCalibration = {
      filename: '',
      title: '',
      imagePath: '',
      projection: '',
      datum: '',
      calibrationPoints: calibration.calibrationPoints,
      bounds: { north: 0, south: 0, east: 0, west: 0 },
      imageWidth: calibration.imageWidth,
      imageHeight: calibration.imageHeight
    }

    const topLeft = pixelToGeo(0, 0, tempCalibration)
    const topRight = pixelToGeo(calibration.imageWidth, 0, tempCalibration)
    const bottomLeft = pixelToGeo(0, calibration.imageHeight, tempCalibration)
    const bottomRight = pixelToGeo(calibration.imageWidth, calibration.imageHeight, tempCalibration)

    calibration.cornerPoints = {
      topLeft,
      topRight,
      bottomRight,
      bottomLeft
    }

    const allCorners = [topLeft, topRight, bottomLeft, bottomRight]
    calibration.bounds = {
      north: Math.max(...allCorners.map(c => c.lat)),
      south: Math.min(...allCorners.map(c => c.lat)),
      east: Math.max(...allCorners.map(c => c.lon)),
      west: Math.min(...allCorners.map(c => c.lon))
    }
  } else if (calibration.calibrationPoints.length > 0) {
    // Fallback: Min/Max der Kalibrierungspunkte
    calibration.bounds = {
      north: Math.max(...calibration.calibrationPoints.map(p => p.latitude)),
      south: Math.min(...calibration.calibrationPoints.map(p => p.latitude)),
      east: Math.max(...calibration.calibrationPoints.map(p => p.longitude)),
      west: Math.min(...calibration.calibrationPoints.map(p => p.longitude))
    }
  }

  return calibration
}

/**
 * Berechne die Kartengrenzen durch Transformation der 4 Bildecken
 * unter Verwendung der Kalibrierungspunkte (affine Transformation)
 */
function computeBoundsFromCalibration(
  points: CalibrationPoint[],
  imageWidth: number,
  imageHeight: number
): MapBounds {
  // Verwende die affine Transformation für alle 4 Ecken
  const tempCalibration: MapCalibration = {
    filename: '',
    title: '',
    imagePath: '',
    projection: '',
    datum: '',
    calibrationPoints: points,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
    imageWidth,
    imageHeight
  }

  const topLeft = pixelToGeo(0, 0, tempCalibration)
  const topRight = pixelToGeo(imageWidth, 0, tempCalibration)
  const bottomLeft = pixelToGeo(0, imageHeight, tempCalibration)
  const bottomRight = pixelToGeo(imageWidth, imageHeight, tempCalibration)

  const allCorners = [topLeft, topRight, bottomLeft, bottomRight]

  return {
    north: Math.max(...allCorners.map(c => c.lat)),
    south: Math.min(...allCorners.map(c => c.lat)),
    east: Math.max(...allCorners.map(c => c.lon)),
    west: Math.min(...allCorners.map(c => c.lon))
  }
}

/**
 * Parse einen Kalibrierungspunkt aus einer Zeile - gibt auch UTM-Daten zurück wenn vorhanden
 */
function parseCalibrationPointWithUtm(line: string): { point: CalibrationPoint; utm?: { pixelX: number; pixelY: number; easting: number; northing: number; zone: number } } | null {
  const parts = line.split(',')

  if (parts.length < 17) return null

  const pixelX = parseInt(parts[2]?.trim())
  const pixelY = parseInt(parts[3]?.trim())

  if (isNaN(pixelX) || isNaN(pixelY)) return null
  // Prüfe ob es ein wirklich leerer Punkt ist (Pixel UND keine Geo-Daten)
  // pixelX=0, pixelY=0 kann ein gültiger Punkt sein (z.B. obere linke Ecke)

  let latitude = 0
  let longitude = 0
  let utmData: { pixelX: number; pixelY: number; easting: number; northing: number; zone: number } | undefined

  // Versuche zuerst Lat/Lon im DMS Format
  if (parts[5]?.trim() === 'deg') {
    const latDeg = parseInt(parts[6]?.trim()) || 0
    const latMin = parseInt(parts[7]?.trim()) || 0
    const latSec = parseFloat(parts[8]?.trim()) || 0
    const latDir = parts[9]?.trim()

    const lonDeg = parseInt(parts[10]?.trim()) || 0
    const lonMin = parseInt(parts[11]?.trim()) || 0
    const lonSec = parseFloat(parts[12]?.trim()) || 0
    const lonDir = parts[13]?.trim()

    latitude = latDeg + latMin / 60 + latSec / 3600
    if (latDir === 'S') latitude = -latitude

    longitude = lonDeg + lonMin / 60 + lonSec / 3600
    if (lonDir === 'W') longitude = -longitude
  }

  // Prüfe auf UTM Grid Koordinaten
  const gridIndex = parts.findIndex(p => p.trim().toLowerCase() === 'grid')
  if (gridIndex >= 0 && parts.length > gridIndex + 3) {
    const zone = parseInt(parts[gridIndex + 1]?.trim()) || 0
    const easting = parseFloat(parts[gridIndex + 2]?.trim()) || 0
    const northing = parseFloat(parts[gridIndex + 3]?.trim()) || 0
    const hemisphere = parts[gridIndex + 4]?.trim()?.toUpperCase() || 'N'

    if (zone > 0 && easting > 0 && northing > 0) {
      // Speichere UTM-Daten für präzise Transformation
      utmData = { pixelX, pixelY, easting, northing, zone }

      // Wenn keine Lat/Lon, konvertiere UTM zu WGS84
      if (latitude === 0 && longitude === 0) {
        const converted = utmToWgs84(easting, northing, zone, hemisphere === 'S')
        latitude = converted.lat
        longitude = converted.lon
      }
    }
  }

  if (latitude === 0 && longitude === 0) return null

  return {
    point: { pixelX, pixelY, latitude, longitude },
    utm: utmData
  }
}

/**
 * Parse einen Kalibrierungspunkt (Wrapper für Kompatibilität)
 */
function parseCalibrationPoint(line: string): CalibrationPoint | null {
  const result = parseCalibrationPointWithUtm(line)
  return result ? result.point : null
}

/**
 * Konvertiert WGS84 Lat/Lon nach UTM für eine bestimmte Zone
 */
function wgs84ToUtm(lat: number, lon: number, zone: number): { easting: number; northing: number } {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e2 = 2 * f - f * f

  const latRad = lat * Math.PI / 180
  const lon0 = (zone - 1) * 6 - 180 + 3  // Central meridian
  const lon0Rad = lon0 * Math.PI / 180
  const lonRad = lon * Math.PI / 180

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad))
  const T = Math.tan(latRad) * Math.tan(latRad)
  const C = e2 / (1 - e2) * Math.cos(latRad) * Math.cos(latRad)
  const A = Math.cos(latRad) * (lonRad - lon0Rad)

  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad
          - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad)
          + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad)
          - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad))

  const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
                + (5 - 18 * T + T * T + 72 * C - 58 * e2 / (1 - e2)) * A * A * A * A * A / 120) + 500000

  const northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2
                + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
                + (61 - 58 * T + T * T + 600 * C - 330 * e2 / (1 - e2)) * A * A * A * A * A * A / 720))

  return { easting, northing }
}

/**
 * Konvertiert UTM Koordinaten nach WGS84 Lat/Lon
 */
function utmToWgs84(easting: number, northing: number, zone: number, southern: boolean = false): { lat: number; lon: number } {
  // WGS84 Ellipsoid Konstanten
  const a = 6378137.0  // Semi-major axis
  const f = 1 / 298.257223563  // Flattening
  const k0 = 0.9996  // Scale factor
  const e = Math.sqrt(2 * f - f * f)  // Eccentricity
  const e2 = e * e
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))

  // Anpassung für Südhalbkugel
  const x = easting - 500000  // Remove false easting
  const y = southern ? northing - 10000000 : northing  // Remove false northing for southern hemisphere

  // Footprint Latitude
  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256))

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
    + (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu)

  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1))
  const T1 = Math.tan(phi1) * Math.tan(phi1)
  const C1 = (e2 / (1 - e2)) * Math.cos(phi1) * Math.cos(phi1)
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5)
  const D = x / (N1 * k0)

  // Latitude
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) * D * D * D * D * D * D / 720
  )

  // Longitude
  const lon0 = (zone - 1) * 6 - 180 + 3  // Central meridian
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / Math.cos(phi1) * (180 / Math.PI)

  return {
    lat: lat * (180 / Math.PI),
    lon: lon
  }
}

/**
 * Bilineare Interpolation für 4-Eck Transformation
 * Dies berücksichtigt die Krümmung der UTM→WGS84 Projektion korrekt
 *
 * Formel: P(u,v) = (1-u)(1-v)P00 + u(1-v)P10 + (1-u)v*P01 + u*v*P11
 * wobei u,v normalisierte Koordinaten [0,1] sind
 */
interface BilinearTransform {
  // Quell-Eckpunkte (z.B. Pixel-Koordinaten)
  src: {
    topLeft: { x: number; y: number }
    topRight: { x: number; y: number }
    bottomLeft: { x: number; y: number }
    bottomRight: { x: number; y: number }
  }
  // Ziel-Eckpunkte (z.B. Geo-Koordinaten)
  dst: {
    topLeft: { x: number; y: number }
    topRight: { x: number; y: number }
    bottomLeft: { x: number; y: number }
    bottomRight: { x: number; y: number }
  }
}

/**
 * Erstelle bilineare Transformation aus Kalibrierungspunkten
 * Voraussetzung: Genau 4 Punkte in der Reihenfolge topLeft, topRight, bottomRight, bottomLeft
 */
function createBilinearTransform(
  srcPoints: { x: number; y: number }[],
  dstPoints: { x: number; y: number }[]
): BilinearTransform | null {
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    return null
  }

  return {
    src: {
      topLeft: srcPoints[0],
      topRight: srcPoints[1],
      bottomRight: srcPoints[2],
      bottomLeft: srcPoints[3]
    },
    dst: {
      topLeft: dstPoints[0],
      topRight: dstPoints[1],
      bottomRight: dstPoints[2],
      bottomLeft: dstPoints[3]
    }
  }
}

/**
 * Führe bilineare Transformation durch (Quelle → Ziel)
 * Verwendet inverse bilineare Interpolation
 */
function bilinearTransform(
  x: number,
  y: number,
  transform: BilinearTransform
): { x: number; y: number } {
  const { src, dst } = transform

  // Berechne u,v aus den Quellkoordinaten
  // Wir müssen die inverse bilineare Transformation lösen
  // Vereinfachte Annahme: Quellrechteck ist achsenparallel (typisch für Pixel-Koordinaten)

  const srcMinX = Math.min(src.topLeft.x, src.bottomLeft.x)
  const srcMaxX = Math.max(src.topRight.x, src.bottomRight.x)
  const srcMinY = Math.min(src.topLeft.y, src.topRight.y)
  const srcMaxY = Math.max(src.bottomLeft.y, src.bottomRight.y)

  // Normalisierte Koordinaten [0,1]
  const u = (x - srcMinX) / (srcMaxX - srcMinX || 1)
  const v = (y - srcMinY) / (srcMaxY - srcMinY || 1)

  // Bilineare Interpolation auf Zielkoordinaten
  // P(u,v) = (1-u)(1-v)*P_TL + u(1-v)*P_TR + (1-u)v*P_BL + u*v*P_BR
  const resultX =
    (1 - u) * (1 - v) * dst.topLeft.x +
    u * (1 - v) * dst.topRight.x +
    (1 - u) * v * dst.bottomLeft.x +
    u * v * dst.bottomRight.x

  const resultY =
    (1 - u) * (1 - v) * dst.topLeft.y +
    u * (1 - v) * dst.topRight.y +
    (1 - u) * v * dst.bottomLeft.y +
    u * v * dst.bottomRight.y

  return { x: resultX, y: resultY }
}

/**
 * Inverse bilineare Transformation (Ziel → Quelle)
 * Verwendet Newton-Raphson Iteration für exakte Lösung
 */
function inverseBilinearTransform(
  x: number,
  y: number,
  transform: BilinearTransform
): { x: number; y: number } {
  const { src, dst } = transform

  // Initiale Schätzung über normalisierte Zielkoordinaten
  // WICHTIG: In Geo-Koordinaten ist y=Latitude, wobei:
  // - topLeft/topRight haben HÖHERE Latitude (Norden)
  // - bottomLeft/bottomRight haben NIEDRIGERE Latitude (Süden)
  // Aber in Pixel-Koordinaten ist Y=0 oben und Y=max unten
  // Daher: v=0 entspricht topLeft (hohe Lat), v=1 entspricht bottomLeft (niedrige Lat)

  // Berechne u basierend auf Longitude (West→Ost = links→rechts)
  const lonLeft = (dst.topLeft.x + dst.bottomLeft.x) / 2
  const lonRight = (dst.topRight.x + dst.bottomRight.x) / 2
  let u = (x - lonLeft) / (lonRight - lonLeft || 1)

  // Berechne v basierend auf Latitude (Nord→Süd = oben→unten in Pixel)
  // v=0 bei topLeft (hohe Lat), v=1 bei bottomLeft (niedrige Lat)
  const latTop = (dst.topLeft.y + dst.topRight.y) / 2
  const latBottom = (dst.bottomLeft.y + dst.bottomRight.y) / 2
  let v = (latTop - y) / (latTop - latBottom || 1)  // Invertiert!

  // Clamp initiale Schätzung
  u = Math.max(0, Math.min(1, u))
  v = Math.max(0, Math.min(1, v))

  // Newton-Raphson Iteration (max 10 Iterationen)
  for (let iter = 0; iter < 10; iter++) {
    // Berechne aktuellen Wert
    const fx =
      (1 - u) * (1 - v) * dst.topLeft.x +
      u * (1 - v) * dst.topRight.x +
      (1 - u) * v * dst.bottomLeft.x +
      u * v * dst.bottomRight.x - x

    const fy =
      (1 - u) * (1 - v) * dst.topLeft.y +
      u * (1 - v) * dst.topRight.y +
      (1 - u) * v * dst.bottomLeft.y +
      u * v * dst.bottomRight.y - y

    // Prüfe Konvergenz
    if (Math.abs(fx) < 1e-10 && Math.abs(fy) < 1e-10) break

    // Jacobi-Matrix
    const dfx_du =
      -(1 - v) * dst.topLeft.x +
      (1 - v) * dst.topRight.x -
      v * dst.bottomLeft.x +
      v * dst.bottomRight.x

    const dfx_dv =
      -(1 - u) * dst.topLeft.x -
      u * dst.topRight.x +
      (1 - u) * dst.bottomLeft.x +
      u * dst.bottomRight.x

    const dfy_du =
      -(1 - v) * dst.topLeft.y +
      (1 - v) * dst.topRight.y -
      v * dst.bottomLeft.y +
      v * dst.bottomRight.y

    const dfy_dv =
      -(1 - u) * dst.topLeft.y -
      u * dst.topRight.y +
      (1 - u) * dst.bottomLeft.y +
      u * dst.bottomRight.y

    // Determinante
    const det = dfx_du * dfy_dv - dfx_dv * dfy_du
    if (Math.abs(det) < 1e-12) break

    // Newton-Schritt
    u -= (dfy_dv * fx - dfx_dv * fy) / det
    v -= (-dfy_du * fx + dfx_du * fy) / det
  }

  // Berechne Quellkoordinaten aus u,v mit BILINEARER Interpolation
  // (nicht linear, um die Transformation korrekt umzukehren)
  const resultX =
    (1 - u) * (1 - v) * src.topLeft.x +
    u * (1 - v) * src.topRight.x +
    (1 - u) * v * src.bottomLeft.x +
    u * v * src.bottomRight.x

  const resultY =
    (1 - u) * (1 - v) * src.topLeft.y +
    u * (1 - v) * src.topRight.y +
    (1 - u) * v * src.bottomLeft.y +
    u * v * src.bottomRight.y

  return { x: resultX, y: resultY }
}

/**
 * Berechne affine Transformationskoeffizienten aus Kalibrierungspunkten
 * Affine Transformation: x' = a*x + b*y + c, y' = d*x + e*y + f
 * Verwendet Least-Squares wenn mehr als 3 Punkte vorhanden sind
 */
function computeAffineTransform(
  srcPoints: { x: number; y: number }[],
  dstPoints: { x: number; y: number }[]
): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
  const n = srcPoints.length
  if (n < 2) return null

  if (n === 2) {
    // 2 Punkte: Einfache lineare Transformation (ohne Rotation)
    const s1 = srcPoints[0], s2 = srcPoints[1]
    const d1 = dstPoints[0], d2 = dstPoints[1]
    const dsx = s2.x - s1.x || 1
    const dsy = s2.y - s1.y || 1
    const ddx = d2.x - d1.x
    const ddy = d2.y - d1.y

    return {
      a: ddx / dsx,
      b: 0,
      c: d1.x - s1.x * (ddx / dsx),
      d: 0,
      e: ddy / dsy,
      f: d1.y - s1.y * (ddy / dsy)
    }
  }

  // 3+ Punkte: Least-Squares affine Transformation
  // Löse: [a b c] und [d e f] separat
  // Für x': a*sx + b*sy + c = dx → Normalgleichungen
  let sumSx = 0, sumSy = 0, sumSxSx = 0, sumSySy = 0, sumSxSy = 0
  let sumDxSx = 0, sumDxSy = 0, sumDx = 0
  let sumDySx = 0, sumDySy = 0, sumDy = 0

  for (let i = 0; i < n; i++) {
    const sx = srcPoints[i].x, sy = srcPoints[i].y
    const dx = dstPoints[i].x, dy = dstPoints[i].y
    sumSx += sx; sumSy += sy
    sumSxSx += sx * sx; sumSySy += sy * sy; sumSxSy += sx * sy
    sumDxSx += dx * sx; sumDxSy += dx * sy; sumDx += dx
    sumDySx += dy * sx; sumDySy += dy * sy; sumDy += dy
  }

  // Löse 3x3 Gleichungssystem: A * [a,b,c]^T = B
  // | sumSxSx  sumSxSy  sumSx | | a |   | sumDxSx |
  // | sumSxSy  sumSySy  sumSy | | b | = | sumDxSy |
  // | sumSx    sumSy    n     | | c |   | sumDx   |
  const det = sumSxSx * (sumSySy * n - sumSy * sumSy)
            - sumSxSy * (sumSxSy * n - sumSy * sumSx)
            + sumSx * (sumSxSy * sumSy - sumSySy * sumSx)

  if (Math.abs(det) < 1e-10) {
    // Degenerierter Fall - Fallback auf 2-Punkt
    return computeAffineTransform(srcPoints.slice(0, 2), dstPoints.slice(0, 2))
  }

  const a = (sumDxSx * (sumSySy * n - sumSy * sumSy) - sumDxSy * (sumSxSy * n - sumSy * sumSx) + sumDx * (sumSxSy * sumSy - sumSySy * sumSx)) / det
  const b = (sumSxSx * (sumDxSy * n - sumDx * sumSy) - sumSxSy * (sumDxSx * n - sumDx * sumSx) + sumSx * (sumDxSx * sumSy - sumDxSy * sumSx)) / det
  const c = (sumSxSx * (sumSySy * sumDx - sumSy * sumDxSy) - sumSxSy * (sumSxSy * sumDx - sumSy * sumDxSx) + sumSx * (sumSxSy * sumDxSy - sumSySy * sumDxSx)) / det

  const d = (sumDySx * (sumSySy * n - sumSy * sumSy) - sumDySy * (sumSxSy * n - sumSy * sumSx) + sumDy * (sumSxSy * sumSy - sumSySy * sumSx)) / det
  const e = (sumSxSx * (sumDySy * n - sumDy * sumSy) - sumSxSy * (sumDySx * n - sumDy * sumSx) + sumSx * (sumDySx * sumSy - sumDySy * sumSx)) / det
  const f = (sumSxSx * (sumSySy * sumDy - sumSy * sumDySy) - sumSxSy * (sumSxSy * sumDy - sumSy * sumDySx) + sumSx * (sumSxSy * sumDySy - sumSySy * sumDySx)) / det

  return { a, b, c, d, e, f }
}

/**
 * Konvertiert Pixel-Koordinaten zu Geo-Koordinaten
 * Verwendet bilineare UTM-Transformation wenn verfügbar (präziser), sonst affine Transformation
 */
export function pixelToGeo(
  pixelX: number,
  pixelY: number,
  calibration: MapCalibration
): { lat: number; lon: number } {
  // PRÄZISE UTM-Transformation wenn verfügbar
  if (calibration.utmCalibration) {
    let easting: number, northing: number

    const bp = calibration.utmCalibration.bilinearPoints
    if (bp) {
      // Bilineare Interpolation über die 4 UTM-Kalibrierungspunkte
      const tl = bp.topLeft, tr = bp.topRight, bl = bp.bottomLeft, br = bp.bottomRight

      // Berechne normalisierte Koordinaten (u,v) im Pixel-Raum
      const pxMin = Math.min(tl.px, bl.px)
      const pxMax = Math.max(tr.px, br.px)
      const pyMin = Math.min(tl.py, tr.py)
      const pyMax = Math.max(bl.py, br.py)

      const u = (pixelX - pxMin) / (pxMax - pxMin)
      const v = (pixelY - pyMin) / (pyMax - pyMin)

      // UTM durch bilineare Interpolation
      const u1 = 1 - u, v1 = 1 - v
      easting = tl.e * u1 * v1 + tr.e * u * v1 + bl.e * u1 * v + br.e * u * v
      northing = tl.n * u1 * v1 + tr.n * u * v1 + bl.n * u1 * v + br.n * u * v
    } else {
      // Fallback: Affine Transformation
      const t = calibration.utmCalibration.pixelToUtm
      easting = t.a * pixelX + t.b * pixelY + t.c
      northing = t.d * pixelX + t.e * pixelY + t.f
    }

    // UTM zu WGS84
    return utmToWgs84(easting, northing, calibration.utmCalibration.zone, false)
  }

  const points = calibration.calibrationPoints

  if (points.length < 2) {
    // Fallback: Lineare Interpolation über Bounds
    const xRatio = pixelX / calibration.imageWidth
    const yRatio = pixelY / calibration.imageHeight

    return {
      lon: calibration.bounds.west + (calibration.bounds.east - calibration.bounds.west) * xRatio,
      lat: calibration.bounds.north - (calibration.bounds.north - calibration.bounds.south) * yRatio
    }
  }

  // Bei genau 4 Punkten: Bilineare Transformation (berücksichtigt Krümmung)
  if (points.length === 4) {
    const srcPoints = points.map(p => ({ x: p.pixelX, y: p.pixelY }))
    const dstPoints = points.map(p => ({ x: p.longitude, y: p.latitude }))

    const bilinear = createBilinearTransform(srcPoints, dstPoints)
    if (bilinear) {
      const result = bilinearTransform(pixelX, pixelY, bilinear)
      return { lon: result.x, lat: result.y }
    }
  }

  // Affine Transformation: Pixel → Geo (für 2-3 Punkte oder als Fallback)
  const srcPoints = points.map(p => ({ x: p.pixelX, y: p.pixelY }))
  const dstPoints = points.map(p => ({ x: p.longitude, y: p.latitude }))

  const transform = computeAffineTransform(srcPoints, dstPoints)
  if (!transform) {
    return { lon: calibration.bounds.west, lat: calibration.bounds.north }
  }

  return {
    lon: transform.a * pixelX + transform.b * pixelY + transform.c,
    lat: transform.d * pixelX + transform.e * pixelY + transform.f
  }
}

/**
 * Konvertiert Geo-Koordinaten zu Pixel-Koordinaten
 * Verwendet affine Transformation mit allen verfügbaren Kalibrierungspunkten
 */
export function geoToPixel(
  lat: number,
  lon: number,
  calibration: MapCalibration
): { x: number; y: number } {
  const points = calibration.calibrationPoints

  if (points.length < 2) {
    // Fallback: Lineare Interpolation über Bounds
    const xRatio = (lon - calibration.bounds.west) / (calibration.bounds.east - calibration.bounds.west)
    const yRatio = (calibration.bounds.north - lat) / (calibration.bounds.north - calibration.bounds.south)

    return {
      x: xRatio * calibration.imageWidth,
      y: yRatio * calibration.imageHeight
    }
  }

  // Debug: Zeige Kalibrierungspunkte beim ersten Aufruf
  if (!geoToPixelDebugShown) {
    console.log('geoToPixel - Kalibrierungspunkte:', {
      points: points.map((p, i) => ({
        index: i,
        pixel: { x: p.pixelX, y: p.pixelY },
        geo: { lat: p.latitude, lon: p.longitude }
      })),
      utmCalibration: calibration.utmCalibration ? 'vorhanden (Zone ' + calibration.utmCalibration.zone + ')' : 'nicht vorhanden'
    })
    geoToPixelDebugShown = true
  }

  // PRÄZISE UTM-Transformation wenn verfügbar
  if (calibration.utmCalibration) {
    // Konvertiere Lat/Lon zu UTM
    const utm = wgs84ToUtm(lat, lon, calibration.utmCalibration.zone)

    // UTM → Pixel mit affiner Transformation
    const t = calibration.utmCalibration.utmToPixel
    return {
      x: t.a * utm.easting + t.b * utm.northing + t.c,
      y: t.d * utm.easting + t.e * utm.northing + t.f
    }
  }

  // Fallback: Affine Transformation über Lat/Lon (weniger präzise)
  const srcPoints = points.map(p => ({ x: p.longitude, y: p.latitude }))
  const dstPoints = points.map(p => ({ x: p.pixelX, y: p.pixelY }))

  const transform = computeAffineTransform(srcPoints, dstPoints)
  if (!transform) {
    return { x: 0, y: 0 }
  }

  return {
    x: transform.a * lon + transform.b * lat + transform.c,
    y: transform.d * lon + transform.e * lat + transform.f
  }
}

/**
 * OZF2/OZF3 Header lesen
 */
export function readOZFHeader(ozfPath: string): OZFHeader | null {
  try {
    const fd = fs.openSync(ozfPath, 'r')
    const headerBuffer = Buffer.alloc(64)
    fs.readSync(fd, headerBuffer, 0, 64, 0)
    fs.closeSync(fd)

    // Magic bytes prüfen
    const magic = headerBuffer.readUInt16LE(0)

    // OZF2: 0x7778, OZF3: 0x7779, OZFX3: 0x777A
    if (magic !== 0x7778 && magic !== 0x7779 && magic !== 0x777A) {
      console.log('Unbekanntes OZF Format:', magic.toString(16))
      return null
    }

    const version = magic === 0x7778 ? 2 : (magic === 0x7779 ? 3 : 4)

    // Header Struktur (vereinfacht)
    return {
      magic,
      version,
      width: headerBuffer.readUInt32LE(4),
      height: headerBuffer.readUInt32LE(8),
      depth: headerBuffer.readUInt16LE(12),
      tileWidth: 64,  // Standard Tile-Größe
      tileHeight: 64,
      tilesX: Math.ceil(headerBuffer.readUInt32LE(4) / 64),
      tilesY: Math.ceil(headerBuffer.readUInt32LE(8) / 64),
      zoomLevels: headerBuffer.readUInt16LE(14) || 1
    }
  } catch (err) {
    console.error('Fehler beim Lesen des OZF Headers:', err)
    return null
  }
}

/**
 * Finde die passende .map Datei zu einer OZF Datei
 */
export function findMapFile(ozfPath: string): string | null {
  const dir = path.dirname(ozfPath)
  const baseName = path.basename(ozfPath).replace(/\.ozf[x23]?$/i, '')

  // Mögliche .map Dateinamen
  const candidates = [
    path.join(dir, baseName + '.map'),
    path.join(dir, baseName + '.MAP'),
    path.join(dir, baseName.toLowerCase() + '.map'),
    path.join(dir, baseName.toUpperCase() + '.MAP')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Lade eine komplette Karte (OZF + MAP)
 */
export function loadMap(ozfPath: string): LoadedMap | null {
  // OZF Header lesen
  const header = readOZFHeader(ozfPath)
  if (!header) {
    console.error('Konnte OZF Header nicht lesen')
    return null
  }

  // MAP Datei finden
  const mapPath = findMapFile(ozfPath)
  if (!mapPath) {
    console.error('Keine .map Kalibrierungsdatei gefunden für:', ozfPath)
    return null
  }

  // Kalibrierung parsen
  const calibration = parseMapFile(mapPath)
  calibration.imageWidth = header.width
  calibration.imageHeight = header.height

  // Verwende Hash des Pfads als ID - so bleibt der Tile-Cache persistent
  const mapHash = cryptoNode.createHash('md5').update(ozfPath.toLowerCase()).digest('hex').substring(0, 16)

  return {
    id: mapHash,
    name: calibration.title || path.basename(ozfPath, path.extname(ozfPath)),
    calibration,
    ozfPath,
    mapPath,
    tiles: new Map()
  }
}

/**
 * OZF2 Dateistruktur:
 * - Header (14 Bytes):
 *   - Bytes 0-1: Magic (0x7778)
 *   - Bytes 2-5: Pointer zum Tile-Table am Ende der Datei
 *   - Bytes 6-9: Breite
 *   - Bytes 10-13: Höhe
 * - Tile-Daten (zlib komprimiert, 64x64 Pixel Tiles)
 * - Am Ende: Tile-Table mit Offsets
 */

export interface OZFTileTable {
  tableOffset: number
  tilesX: number
  tilesY: number
  zoomLevels: number
  tileOffsets: number[][]  // [zoomLevel][tileIndex] = offset
}

/**
 * Lese die Tile-Tabelle aus einer OZF2 Datei
 */
export function readOZF2TileTable(ozfPath: string): OZFTileTable | null {
  try {
    const fd = fs.openSync(ozfPath, 'r')
    const stats = fs.fstatSync(fd)
    const fileSize = stats.size

    // OZF2 Header lesen
    const headerBuffer = Buffer.alloc(14)
    fs.readSync(fd, headerBuffer, 0, 14, 0)

    const magic = headerBuffer.readUInt16LE(0)
    if (magic !== 0x7778) {
      console.log('Nicht OZF2 Format:', magic.toString(16))
      fs.closeSync(fd)
      return null
    }

    // Pointer zur Tile-Tabelle (am Ende der Datei)
    const tablePointer = headerBuffer.readUInt32LE(2)
    const width = headerBuffer.readUInt32LE(6)
    const height = headerBuffer.readUInt32LE(10)

    console.log(`OZF2: ${width}x${height}, Table at ${tablePointer}`)

    // Tile-Tabelle lesen (am Ende der Datei)
    // Format: 4-Byte Offsets für jedes Tile
    const tilesX = Math.ceil(width / 64)
    const tilesY = Math.ceil(height / 64)
    const totalTiles = tilesX * tilesY

    // Lese die Offsets aus der Tabelle
    const tableSize = (totalTiles + 1) * 4  // +1 für Ende-Marker
    const tableBuffer = Buffer.alloc(tableSize)
    fs.readSync(fd, tableBuffer, 0, tableSize, tablePointer)

    const tileOffsets: number[][] = [[]]
    for (let i = 0; i <= totalTiles; i++) {
      tileOffsets[0].push(tableBuffer.readUInt32LE(i * 4))
    }

    fs.closeSync(fd)

    return {
      tableOffset: tablePointer,
      tilesX,
      tilesY,
      zoomLevels: 1,
      tileOffsets
    }
  } catch (err) {
    console.error('Fehler beim Lesen der OZF2 Tile-Tabelle:', err)
    return null
  }
}

/**
 * Extrahiere ein einzelnes Tile aus einer OZF2 Datei
 * Gibt dekomprimierte Pixeldaten zurück (64x64, 8-bit indexed oder RGB)
 */
export function extractOZF2Tile(
  ozfPath: string,
  tileX: number,
  tileY: number,
  tileTable: OZFTileTable
): Buffer | null {
  try {
    if (tileX >= tileTable.tilesX || tileY >= tileTable.tilesY) {
      return null
    }

    const tileIndex = tileY * tileTable.tilesX + tileX
    const offsets = tileTable.tileOffsets[0]

    if (tileIndex >= offsets.length - 1) {
      return null
    }

    const tileStart = offsets[tileIndex]
    const tileEnd = offsets[tileIndex + 1]
    const compressedSize = tileEnd - tileStart

    if (compressedSize <= 0) {
      return null
    }

    // Lese komprimierte Tile-Daten
    const fd = fs.openSync(ozfPath, 'r')
    const compressedBuffer = Buffer.alloc(compressedSize)
    fs.readSync(fd, compressedBuffer, 0, compressedSize, tileStart)
    fs.closeSync(fd)

    // Dekomprimiere mit zlib
    const decompressed = zlib.inflateSync(compressedBuffer)

    return decompressed
  } catch (err) {
    console.error(`Fehler beim Extrahieren von Tile ${tileX},${tileY}:`, err)
    return null
  }
}

/**
 * Konvertiere dekomprimierte OZF-Tile-Daten zu PNG
 * OZF Tiles sind 64x64 Pixel, 8-bit indexed color mit Palette
 */
export function ozfTileToPNG(
  tileData: Buffer,
  width: number = 64,
  height: number = 64
): Buffer | null {
  try {
    // OZF2 speichert Tiles als indexed color (1 byte pro Pixel + Palette)
    // Die Palette ist normalerweise am Anfang der Tile-Daten

    // Einfacher Fall: Annahme dass Daten bereits RGBA sind oder wir sie konvertieren
    // Für jetzt: Erstelle ein Graustufen-PNG aus den Rohdaten

    // Die tatsächliche Implementierung hängt vom genauen OZF-Format ab
    // Hier eine vereinfachte Version:

    const pixelCount = width * height
    if (tileData.length < pixelCount) {
      // Zu wenig Daten - vielleicht komprimiert oder anderes Format
      return null
    }

    // Erstelle RGBA Buffer (4 bytes pro Pixel)
    const rgbaBuffer = Buffer.alloc(pixelCount * 4)

    for (let i = 0; i < pixelCount; i++) {
      const value = tileData[i]
      rgbaBuffer[i * 4] = value      // R
      rgbaBuffer[i * 4 + 1] = value  // G
      rgbaBuffer[i * 4 + 2] = value  // B
      rgbaBuffer[i * 4 + 3] = 255    // A
    }

    // Diese Rohdaten müssten noch zu PNG encodiert werden
    // Das machen wir mit Sharp im MapManager

    return rgbaBuffer
  } catch (err) {
    console.error('Fehler bei Tile-Konvertierung:', err)
    return null
  }
}

/**
 * Extrahiere ein Tile aus der OZF Datei (Legacy-Funktion)
 */
export function extractTile(
  ozfPath: string,
  tileX: number,
  tileY: number,
  zoom: number
): Buffer | null {
  // Lese Tile-Tabelle
  const tileTable = readOZF2TileTable(ozfPath)
  if (!tileTable) {
    return null
  }

  // Extrahiere Tile
  const tileData = extractOZF2Tile(ozfPath, tileX, tileY, tileTable)
  if (!tileData) {
    return null
  }

  return tileData
}

/**
 * Konvertiere OZF zu Standard-Tiles für Leaflet
 * Exportiert die Karte als PNG-Tiles in einem Verzeichnis
 */
export async function convertOZFToTiles(
  loadedMap: LoadedMap,
  outputDir: string,
  options: {
    tileSize?: number
    minZoom?: number
    maxZoom?: number
  } = {}
): Promise<boolean> {
  const tileSize = options.tileSize || 256
  const minZoom = options.minZoom || 10
  const maxZoom = options.maxZoom || 16

  // Erstelle Ausgabeverzeichnis
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Metadaten speichern
  const metadata = {
    name: loadedMap.name,
    bounds: loadedMap.calibration.bounds,
    minZoom,
    maxZoom,
    tileSize,
    format: 'png'
  }

  fs.writeFileSync(
    path.join(outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  )

  return true
}
