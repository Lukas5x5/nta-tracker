/**
 * TileGenerator - Generiert Tiles aus OZI-Karten mit korrekten WGS84-Koordinaten
 *
 * Jede Tile bekommt ihre eigenen 4 WGS84-Eckpunkte, berechnet aus der UTM-Kalibrierung.
 * Dies ermöglicht eine exakte Darstellung der Karte ohne Verzerrung durch die
 * UTM→WGS84 Projektion (Meridiankonvergenz).
 */

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { MapCalibration } from './OZFParser'

// Tile-Größe in Pixel
const TILE_SIZE = 256

// Typ für Tile-Info
export interface TileInfo {
  x: number  // Tile-Index X
  y: number  // Tile-Index Y
  // WGS84-Eckpunkte für rotiertes Overlay
  topLeft: { lat: number; lon: number }
  topRight: { lat: number; lon: number }
  bottomLeft: { lat: number; lon: number }
  bottomRight: { lat: number; lon: number }
  // Pixel-Koordinaten im Originalbild
  pixelX: number
  pixelY: number
  pixelWidth: number
  pixelHeight: number
}

// Tile-Index Datei
export interface TileIndex {
  version: number
  tileSize: number
  imageWidth: number
  imageHeight: number
  tilesX: number
  tilesY: number
  totalTiles: number
  // UTM-Zone für Referenz
  utmZone: number
  // Bounds (für schnelle Filterung)
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  // Alle Tiles mit ihren WGS84-Ecken
  tiles: TileInfo[]
}

/**
 * Konvertiert UTM zu WGS84
 * (Kopie aus OZFParser für Unabhängigkeit)
 */
function utmToWgs84(easting: number, northing: number, zone: number, southern: boolean = false): { lat: number; lon: number } {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e = Math.sqrt(2 * f - f * f)
  const e2 = e * e
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))

  const x = easting - 500000
  const y = southern ? northing - 10000000 : northing

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

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) * D * D * D * D * D * D / 720
  )

  const lon0 = (zone - 1) * 6 - 180 + 3
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
 * Konvertiert Pixel-Koordinaten zu UTM
 * Verwendet die affine Transformation (pixelToUtm) die für das gesamte Bild gilt
 * Die bilinearPoints sind nur für den kalibrierten Bereich, nicht für die Bildränder!
 */
function pixelToUtm(
  pixelX: number,
  pixelY: number,
  calibration: MapCalibration
): { easting: number; northing: number } | null {
  const utmCal = calibration.utmCalibration
  if (!utmCal) return null

  // Verwende IMMER die affine Transformation
  // Die bilinearPoints sind nur für den kalibrierten Bereich (Point01-04),
  // nicht für Pixel außerhalb dieses Bereichs (z.B. Bildränder)
  const t = utmCal.pixelToUtm
  return {
    easting: t.a * pixelX + t.b * pixelY + t.c,
    northing: t.d * pixelX + t.e * pixelY + t.f
  }
}

/**
 * Konvertiert Pixel-Koordinaten zu WGS84
 */
function pixelToWgs84(
  pixelX: number,
  pixelY: number,
  calibration: MapCalibration
): { lat: number; lon: number } | null {
  const utmCal = calibration.utmCalibration
  if (!utmCal) return null

  const utm = pixelToUtm(pixelX, pixelY, calibration)
  if (!utm) return null

  return utmToWgs84(utm.easting, utm.northing, utmCal.zone, false)
}

/**
 * Generiert alle Tiles für eine Karte
 */
export async function generateTiles(
  imagePath: string,
  calibration: MapCalibration,
  outputDir: string,
  progressCallback?: (message: string, percent: number) => void
): Promise<TileIndex | null> {
  const progress = progressCallback || ((msg: string, pct: number) => console.log(`${pct}% - ${msg}`))

  if (!calibration.utmCalibration) {
    console.error('Keine UTM-Kalibrierung vorhanden - Tiles können nicht generiert werden')
    return null
  }

  // Erstelle Output-Verzeichnis
  const tilesDir = path.join(outputDir, 'tiles')
  if (!fs.existsSync(tilesDir)) {
    fs.mkdirSync(tilesDir, { recursive: true })
  }

  progress('Lade Bild...', 5)

  // Lade Bild-Metadaten
  const metadata = await sharp(imagePath, { limitInputPixels: false }).metadata()
  const imgWidth = metadata.width || calibration.imageWidth
  const imgHeight = metadata.height || calibration.imageHeight

  // Berechne Anzahl Tiles
  const tilesX = Math.ceil(imgWidth / TILE_SIZE)
  const tilesY = Math.ceil(imgHeight / TILE_SIZE)
  const totalTiles = tilesX * tilesY

  console.log(`Generiere ${totalTiles} Tiles (${tilesX} x ${tilesY}) aus ${imgWidth}x${imgHeight} Bild`)
  progress(`Generiere ${totalTiles} Tiles...`, 10)

  // Tile-Index initialisieren
  const tileIndex: TileIndex = {
    version: 1,
    tileSize: TILE_SIZE,
    imageWidth: imgWidth,
    imageHeight: imgHeight,
    tilesX,
    tilesY,
    totalTiles,
    utmZone: calibration.utmCalibration.zone,
    bounds: calibration.bounds,
    tiles: []
  }

  // Lade das gesamte Bild für schnelles Tile-Extraction
  const imageBuffer = await sharp(imagePath, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer()

  let tilesGenerated = 0

  // Generiere Tiles
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // Pixel-Koordinaten dieser Tile
      const px = tx * TILE_SIZE
      const py = ty * TILE_SIZE
      const pw = Math.min(TILE_SIZE, imgWidth - px)
      const ph = Math.min(TILE_SIZE, imgHeight - py)

      // WGS84-Eckpunkte berechnen
      const topLeft = pixelToWgs84(px, py, calibration)
      const topRight = pixelToWgs84(px + pw, py, calibration)
      const bottomLeft = pixelToWgs84(px, py + ph, calibration)
      const bottomRight = pixelToWgs84(px + pw, py + ph, calibration)

      if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
        console.warn(`Konnte WGS84-Koordinaten für Tile ${tx},${ty} nicht berechnen`)
        continue
      }

      // Tile-Info speichern
      const tileInfo: TileInfo = {
        x: tx,
        y: ty,
        topLeft,
        topRight,
        bottomLeft,
        bottomRight,
        pixelX: px,
        pixelY: py,
        pixelWidth: pw,
        pixelHeight: ph
      }
      tileIndex.tiles.push(tileInfo)

      // Tile extrahieren und speichern
      const tilePath = path.join(tilesDir, `${ty}_${tx}.jpg`)

      // Extrahiere Tile aus dem Bild
      await sharp(imageBuffer, {
        raw: {
          width: imgWidth,
          height: imgHeight,
          channels: 4
        }
      })
        .extract({ left: px, top: py, width: pw, height: ph })
        .jpeg({ quality: 90 })
        .toFile(tilePath)

      tilesGenerated++

      // Progress alle 50 Tiles
      if (tilesGenerated % 50 === 0 || tilesGenerated === totalTiles) {
        const percent = 10 + Math.floor((tilesGenerated / totalTiles) * 85)
        progress(`Tile ${tilesGenerated}/${totalTiles}...`, percent)
      }
    }
  }

  // Speichere Tile-Index
  progress('Speichere Index...', 98)
  const indexPath = path.join(outputDir, 'tile-index.json')
  fs.writeFileSync(indexPath, JSON.stringify(tileIndex, null, 2))

  progress('Fertig!', 100)
  console.log(`${tilesGenerated} Tiles generiert, Index gespeichert: ${indexPath}`)

  return tileIndex
}

/**
 * Lädt den Tile-Index für eine Karte
 */
export function loadTileIndex(mapDir: string): TileIndex | null {
  const indexPath = path.join(mapDir, 'tile-index.json')
  if (!fs.existsSync(indexPath)) {
    return null
  }

  try {
    const data = fs.readFileSync(indexPath, 'utf8')
    return JSON.parse(data) as TileIndex
  } catch (err) {
    console.error('Fehler beim Laden des Tile-Index:', err)
    return null
  }
}

/**
 * Gibt den Pfad zu einer Tile zurück
 */
export function getTilePath(mapDir: string, tileX: number, tileY: number): string {
  return path.join(mapDir, 'tiles', `${tileY}_${tileX}.jpg`)
}

/**
 * Prüft ob Tiles für eine Karte existieren
 */
export function hasTiles(mapDir: string): boolean {
  const indexPath = path.join(mapDir, 'tile-index.json')
  return fs.existsSync(indexPath)
}
