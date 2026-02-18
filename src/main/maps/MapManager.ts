/**
 * MapManager - Verwaltet OZF Karten und deren Konvertierung
 * Unterstützt Tile-basiertes Laden für große Bilder (wie OziExplorer)
 * Verwendet geotiff.js für speichereffizientes Laden großer TIFFs
 */

import * as fs from 'fs'
import * as path from 'path'
import * as cryptoNode from 'crypto'
import * as http from 'http'
import { app, dialog } from 'electron'
import sharp from 'sharp'
import {
  loadMap,
  parseMapFile,
  MapCalibration,
  LoadedMap,
  geoToPixel,
  pixelToGeo,
  readOZF2TileTable,
  extractOZF2Tile,
  OZFTileTable
} from './OZFParser'
import {
  generateTiles,
  loadTileIndex,
  hasTiles,
  TileIndex,
  TileInfo
} from './TileGenerator'

export interface MapInfo {
  id: string
  name: string
  filename: string
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  imageWidth: number
  imageHeight: number
  isLoaded: boolean
  imagePath: string  // Pfad zum Original-Bild (PNG/JPG aus OZF extrahiert)
  // Eckpunkte für rotiertes Overlay (wenn von OZI-Datei verfügbar)
  cornerPoints?: {
    topLeft: { lat: number; lon: number }
    topRight: { lat: number; lon: number }
    bottomRight: { lat: number; lon: number }
    bottomLeft: { lat: number; lon: number }
  }
  // Tile-basierte Darstellung verfügbar
  hasTiles?: boolean
  // UTM-Zone (für Koordinaten-Anzeige)
  utmZone?: number
}

export class MapManager {
  private maps: Map<string, LoadedMap> = new Map()
  private mapsDir: string
  private tileServer: http.Server | null = null
  private tileServerPort: number = 0
  private tileCache: Map<string, Buffer> = new Map()
  private readonly TILE_SIZE = 256
  private readonly MAX_CACHE_SIZE = 500 // Max Tiles im RAM-Cache
  private tileCacheDir: string // Persistenter Tile-Cache auf Festplatte
  private reprojectedDir: string // Cache für reprojizierte Bilder

  constructor() {
    // Speicherort für Karten
    this.mapsDir = path.join(app.getPath('userData'), 'maps')
    this.tileCacheDir = path.join(app.getPath('userData'), 'tile-cache')
    this.reprojectedDir = path.join(app.getPath('userData'), 'reprojected')
    this.ensureMapsDir()
    this.ensureTileCacheDir()
    this.ensureReprojectedDir()
    this.loadSavedMaps()
    this.startTileServer()
  }

  private ensureTileCacheDir(): void {
    if (!fs.existsSync(this.tileCacheDir)) {
      fs.mkdirSync(this.tileCacheDir, { recursive: true })
    }
  }

  private ensureReprojectedDir(): void {
    if (!fs.existsSync(this.reprojectedDir)) {
      fs.mkdirSync(this.reprojectedDir, { recursive: true })
    }
  }

  /**
   * Pfad zum reprojizierten Bild (falls vorhanden)
   */
  private getReprojectedImagePath(mapId: string): string {
    return path.join(this.reprojectedDir, `${mapId}.jpg`)
  }

  /**
   * Prüfe ob reprojiziertes Bild existiert
   */
  hasReprojectedImage(mapId: string): boolean {
    return fs.existsSync(this.getReprojectedImagePath(mapId))
  }

  /**
   * Reprojiziere ein UTM-Bild nach WGS84 (einmalig beim ersten Laden)
   * Das reprojizierte Bild kann dann als schnelles ImageOverlay angezeigt werden
   */
  async reprojectImage(
    mapId: string,
    progressCallback?: (message: string, percent: number) => void
  ): Promise<{ imagePath: string; bounds: { north: number; south: number; east: number; west: number } } | null> {
    const map = this.maps.get(mapId)
    if (!map) return null

    const reprojectedPath = this.getReprojectedImagePath(mapId)

    // Bereits reprojiziert?
    if (fs.existsSync(reprojectedPath)) {
      console.log('Reprojiziertes Bild bereits vorhanden:', reprojectedPath)
      return {
        imagePath: reprojectedPath,
        bounds: map.calibration.bounds
      }
    }

    const progress = progressCallback || ((msg: string, pct: number) => console.log(`${pct}% - ${msg}`))

    // Finde Original-Bild
    const imagePath = this.getImagePath(mapId)
    if (!imagePath || !fs.existsSync(imagePath)) {
      console.error('Kein Originalbild gefunden für:', mapId)
      return null
    }

    progress('Lade Originalbild...', 5)

    try {
      // Lade Bildmetadaten
      const metadata = await sharp(imagePath, { limitInputPixels: false }).metadata()
      const srcWidth = metadata.width || 0
      const srcHeight = metadata.height || 0

      if (srcWidth === 0 || srcHeight === 0) {
        console.error('Ungültige Bildgröße')
        return null
      }

      progress('Berechne Zielgröße...', 10)

      // Berechne Zielgröße basierend auf den Bounds
      const calibration = map.calibration
      const bounds = calibration.bounds

      // Behalte ungefähr die gleiche Auflösung
      // Berechne Meter pro Pixel im Original (ungefähr)
      const latRange = bounds.north - bounds.south
      const lonRange = bounds.east - bounds.west

      // Zielgröße: Behalte die Originalauflösung für beste Qualität
      // Das reprojizierte Bild wird nur einmal erstellt, daher ist Qualität wichtiger als Größe
      const aspectRatio = lonRange / latRange * Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180)

      // Verwende Originalauflösung, maximal 16000px (für sehr große Karten)
      const MAX_SIZE = 16000
      let dstWidth: number, dstHeight: number

      // Berechne Zielgröße basierend auf Originalgröße
      if (srcWidth >= srcHeight) {
        dstWidth = Math.min(srcWidth, MAX_SIZE)
        dstHeight = Math.round(dstWidth / aspectRatio)
      } else {
        dstHeight = Math.min(srcHeight, MAX_SIZE)
        dstWidth = Math.round(dstHeight * aspectRatio)
      }

      // Stelle sicher, dass beide Dimensionen im Limit sind
      if (dstWidth > MAX_SIZE) {
        dstWidth = MAX_SIZE
        dstHeight = Math.round(MAX_SIZE / aspectRatio)
      }
      if (dstHeight > MAX_SIZE) {
        dstHeight = MAX_SIZE
        dstWidth = Math.round(MAX_SIZE * aspectRatio)
      }

      console.log(`Reprojektion: ${srcWidth}x${srcHeight} -> ${dstWidth}x${dstHeight}`)
      progress(`Reprojiziere Bild (${dstWidth}x${dstHeight})...`, 15)

      // Lade das Quellbild komplett
      const srcImage = await sharp(imagePath, { limitInputPixels: false })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      const srcData = new Uint8Array(srcImage.data.buffer, srcImage.data.byteOffset, srcImage.data.length)

      // Erstelle Zielbild
      const dstData = new Uint8Array(dstWidth * dstHeight * 4)

      // OPTIMIERUNG: Berechne Transformationskoeffizienten einmal vor
      const utmCal = calibration.utmCalibration
      const srcRowStride = srcWidth * 4
      const srcWm1 = srcWidth - 1
      const srcHm1 = srcHeight - 1

      // Vorberechnete Schrittweiten für das Zielbild
      const lonStep = lonRange / (dstWidth - 1)
      const latStep = latRange / (dstHeight - 1)

      let lastProgress = 15

      // WGS84 zu UTM Konstanten (einmal berechnen)
      const a = 6378137.0
      const f = 1 / 298.257223563
      const k0 = 0.9996
      const e2 = 2 * f - f * f

      // Reprojektion: WGS84 -> UTM -> Quell-Pixel
      // Für jeden Ziel-Pixel:
      // 1. Berechne WGS84 (lat, lon) aus den Bounds (linear interpoliert)
      // 2. Konvertiere WGS84 zu UTM
      // 3. Konvertiere UTM zu Quell-Pixel (affine Transformation)

      for (let dstY = 0; dstY < dstHeight; dstY++) {
        // Progress Update alle 5%
        const currentProgress = 15 + Math.floor((dstY / dstHeight) * 80)
        if (currentProgress > lastProgress + 4) {
          progress(`Reprojiziere... ${Math.round((dstY / dstHeight) * 100)}%`, currentProgress)
          lastProgress = currentProgress
        }

        // Normalisierte Y-Position im Zielbild (0=oben, 1=unten)
        const v = dstY / (dstHeight - 1)
        // WGS84 Latitude für diese Zeile
        const lat = bounds.north - v * latRange
        const latRad = lat * Math.PI / 180
        const sinLat = Math.sin(latRad)
        const cosLat = Math.cos(latRad)
        const tanLat = sinLat / cosLat
        const N_lat = a / Math.sqrt(1 - e2 * sinLat * sinLat)
        const T = tanLat * tanLat
        const C = e2 / (1 - e2) * cosLat * cosLat
        const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64) * latRad
                - (3 * e2 / 8 + 3 * e2 * e2 / 32) * Math.sin(2 * latRad)
                + (15 * e2 * e2 / 256) * Math.sin(4 * latRad))

        let dstIdx = dstY * dstWidth * 4

        for (let dstX = 0; dstX < dstWidth; dstX++) {
          // Normalisierte X-Position im Zielbild (0=links, 1=rechts)
          const u = dstX / (dstWidth - 1)

          let srcX: number, srcY: number

          if (utmCal) {
            // WGS84 -> UTM -> Pixel
            const lon = bounds.west + u * lonRange

            const lon0 = (utmCal.zone - 1) * 6 - 180 + 3
            const lonRad = lon * Math.PI / 180
            const lon0Rad = lon0 * Math.PI / 180
            const A = cosLat * (lonRad - lon0Rad)
            const ep2 = e2 / (1 - e2)

            const easting = k0 * N_lat * (A + (1 - T + C) * A * A * A / 6
                          + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A * A * A * A * A / 120) + 500000

            const northing = k0 * (M + N_lat * tanLat * (A * A / 2
                          + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
                          + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A * A * A * A * A * A / 720))

            // UTM -> Pixel: Bilineare Interpolation (berücksichtigt Krümmung)
            // Die Kalibrierungspunkte definieren ein UTM-Gitter
            const bp = utmCal.bilinearPoints
            if (bp) {
              const tl = bp.topLeft, tr = bp.topRight, bl = bp.bottomLeft, br = bp.bottomRight
              // Normalisierte Position im UTM-Raum
              const Emin = Math.min(tl.e, bl.e)
              const Emax = Math.max(tr.e, br.e)
              const Nmin = Math.min(bl.n, br.n)
              const Nmax = Math.max(tl.n, tr.n)

              const uUtm = (easting - Emin) / (Emax - Emin)
              const vUtm = (Nmax - northing) / (Nmax - Nmin)

              // Bilineare Interpolation der Pixel-Koordinaten
              const u1 = 1 - uUtm, v1 = 1 - vUtm
              srcX = tl.px * u1 * v1 + tr.px * uUtm * v1 + bl.px * u1 * vUtm + br.px * uUtm * vUtm
              srcY = tl.py * u1 * v1 + tr.py * uUtm * v1 + bl.py * u1 * vUtm + br.py * uUtm * vUtm
            } else {
              // Fallback: Affine Transformation
              const t = utmCal.utmToPixel
              srcX = t.a * easting + t.b * northing + t.c
              srcY = t.d * easting + t.e * northing + t.f
            }
          } else {
            // Fallback: geoToPixel
            const lat = bounds.north - v * latRange
            const lon = bounds.west + u * lonRange
            const srcPixel = geoToPixel(lat, lon, calibration)
            srcX = srcPixel.x
            srcY = srcPixel.y
          }

          // Bilineare Interpolation
          if (srcX >= 0 && srcX < srcWm1 && srcY >= 0 && srcY < srcHm1) {
            const x0 = srcX | 0
            const y0 = srcY | 0
            const fx = srcX - x0
            const fy = srcY - y0
            const fx1 = 1 - fx
            const fy1 = 1 - fy

            const idx00 = y0 * srcRowStride + x0 * 4
            const idx10 = idx00 + 4
            const idx01 = idx00 + srcRowStride
            const idx11 = idx01 + 4

            // RGBA entrollt
            dstData[dstIdx] = (fx1 * fy1 * srcData[idx00] + fx * fy1 * srcData[idx10] + fx1 * fy * srcData[idx01] + fx * fy * srcData[idx11]) | 0
            dstData[dstIdx + 1] = (fx1 * fy1 * srcData[idx00 + 1] + fx * fy1 * srcData[idx10 + 1] + fx1 * fy * srcData[idx01 + 1] + fx * fy * srcData[idx11 + 1]) | 0
            dstData[dstIdx + 2] = (fx1 * fy1 * srcData[idx00 + 2] + fx * fy1 * srcData[idx10 + 2] + fx1 * fy * srcData[idx01 + 2] + fx * fy * srcData[idx11 + 2]) | 0
            dstData[dstIdx + 3] = (fx1 * fy1 * srcData[idx00 + 3] + fx * fy1 * srcData[idx10 + 3] + fx1 * fy * srcData[idx01 + 3] + fx * fy * srcData[idx11 + 3]) | 0
          }
          // Sonst bleibt es 0 (transparent, da Uint8Array initialisiert mit 0)

          dstIdx += 4
        }
      }

      progress('Speichere reprojiziertes Bild...', 95)

      // Speichere als JPEG
      await sharp(Buffer.from(dstData.buffer), {
        raw: { width: dstWidth, height: dstHeight, channels: 4 }
      })
        .jpeg({ quality: 95 })
        .toFile(reprojectedPath)

      progress('Fertig!', 100)

      console.log('Reprojiziertes Bild gespeichert:', reprojectedPath)

      return {
        imagePath: reprojectedPath,
        bounds: bounds
      }
    } catch (err) {
      console.error('Fehler bei Reprojektion:', err)
      return null
    }
  }

  /**
   * Prüfe ob Tiles für eine Karte existieren (neues System)
   */
  hasMapTiles(mapId: string): boolean {
    const mapDir = path.join(this.mapsDir, mapId)
    return hasTiles(mapDir)
  }

  /**
   * Lade den Tile-Index für eine Karte
   */
  getMapTileIndex(mapId: string): TileIndex | null {
    const mapDir = path.join(this.mapsDir, mapId)
    return loadTileIndex(mapDir)
  }

  /**
   * Generiere Tiles für eine Karte (einmalig beim ersten Laden)
   * Erstellt kleine Tile-Bilder mit jeweils eigenen WGS84-Eckpunkten
   */
  async generateMapTiles(
    mapId: string,
    progressCallback?: (message: string, percent: number) => void
  ): Promise<TileIndex | null> {
    const map = this.maps.get(mapId)
    if (!map) {
      console.error('Karte nicht gefunden:', mapId)
      return null
    }

    // Prüfe ob bereits Tiles existieren
    const mapDir = path.join(this.mapsDir, mapId)
    if (hasTiles(mapDir)) {
      console.log('Tiles bereits vorhanden für:', mapId)
      return loadTileIndex(mapDir)
    }

    // Finde das Original-Bild
    const imagePath = this.getImagePath(mapId)
    if (!imagePath || !fs.existsSync(imagePath)) {
      console.error('Kein Bild gefunden für:', mapId)
      return null
    }

    // Prüfe ob UTM-Kalibrierung vorhanden
    if (!map.calibration.utmCalibration) {
      console.error('Keine UTM-Kalibrierung vorhanden für:', mapId)
      return null
    }

    console.log('Generiere Tiles für:', map.name)
    return await generateTiles(imagePath, map.calibration, mapDir, progressCallback)
  }

  /**
   * Hole Tile-Bild als Data-URL (für schnelles Laden im Frontend)
   */
  getTileDataUrl(mapId: string, tileX: number, tileY: number): string | null {
    const mapDir = path.join(this.mapsDir, mapId)
    const tilePath = path.join(mapDir, 'tiles', `${tileY}_${tileX}.jpg`)

    if (!fs.existsSync(tilePath)) {
      return null
    }

    const data = fs.readFileSync(tilePath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  }

  /**
   * Hole UTM-Kalibrierung für Pixel-basierte Darstellung (OziMapView)
   * Gibt alle Daten zurück, die für die Transformation WGS84 → Pixel benötigt werden
   */
  getUTMCalibration(mapId: string): {
    imageWidth: number
    imageHeight: number
    bounds: { north: number; south: number; east: number; west: number }
    utmZone: number
    utmToPixel: { a: number; b: number; c: number; d: number; e: number; f: number }
  } | null {
    const map = this.maps.get(mapId)
    if (!map || !map.calibration.utmCalibration) {
      return null
    }

    return {
      imageWidth: map.calibration.imageWidth,
      imageHeight: map.calibration.imageHeight,
      bounds: map.calibration.bounds,
      utmZone: map.calibration.utmCalibration.zone,
      utmToPixel: map.calibration.utmCalibration.utmToPixel
    }
  }

  /**
   * Hole gecachtes Tile von Festplatte
   */
  private getCachedTile(mapId: string, z: number, x: number, y: number): Buffer | null {
    const tilePath = path.join(this.tileCacheDir, mapId, `${z}`, `${x}`, `${y}.png`)
    if (fs.existsSync(tilePath)) {
      return fs.readFileSync(tilePath)
    }
    return null
  }

  /**
   * Speichere Tile auf Festplatte
   */
  private saveTileToCache(mapId: string, z: number, x: number, y: number, data: Buffer): void {
    const tileDir = path.join(this.tileCacheDir, mapId, `${z}`, `${x}`)
    if (!fs.existsSync(tileDir)) {
      fs.mkdirSync(tileDir, { recursive: true })
    }
    const tilePath = path.join(tileDir, `${y}.png`)
    fs.writeFileSync(tilePath, data)
  }

  /**
   * Startet einen lokalen HTTP-Server für Tile-Requests
   * Dies ermöglicht das Laden großer Bilder in Teilen (wie OziExplorer)
   */
  private startTileServer(): void {
    this.tileServer = http.createServer(async (req, res) => {
      // CORS Headers
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET')
      res.setHeader('Cache-Control', 'public, max-age=31536000') // 1 Jahr Cache

      const url = req.url || ''

      // Reprojiziertes Bild ausliefern: /reprojected/{mapId}
      const reprojectedMatch = url.match(/\/reprojected\/([^/.]+)/)
      if (reprojectedMatch) {
        const mapId = reprojectedMatch[1]
        const reprojectedPath = this.getReprojectedImagePath(mapId)

        if (!fs.existsSync(reprojectedPath)) {
          res.writeHead(404)
          res.end('Reprojected image not found')
          return
        }

        try {
          const stat = fs.statSync(reprojectedPath)
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': stat.size
          })

          const readStream = fs.createReadStream(reprojectedPath)
          readStream.pipe(res)
          return
        } catch (err) {
          console.error('Reprojected image error:', err)
          res.writeHead(500)
          res.end('Server error')
          return
        }
      }

      // Ganzes Bild ausliefern: /image/{mapId} oder /image/{mapId}.jpg etc.
      const imageMatch = url.match(/\/image\/([^/.]+)/)
      if (imageMatch) {
        const mapId = imageMatch[1]
        console.log('Image-Request für mapId:', mapId)
        const imagePath = this.getImagePath(mapId)

        if (!imagePath || !fs.existsSync(imagePath)) {
          res.writeHead(404)
          res.end('Image not found')
          return
        }

        try {
          const ext = path.extname(imagePath).toLowerCase()
          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.bmp': 'image/bmp'
          }
          const mimeType = mimeTypes[ext] || 'image/jpeg'

          // Streame die Datei direkt - kein Base64, kein Laden in RAM
          const stat = fs.statSync(imagePath)
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': stat.size
          })

          const readStream = fs.createReadStream(imagePath)
          readStream.pipe(res)
          return
        } catch (err) {
          console.error('Image error:', err)
          res.writeHead(500)
          res.end('Server error')
          return
        }
      }

      // Tiles: /tile/{mapId}/{z}/{x}/{y}.png
      const tileMatch = url.match(/\/tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png/)

      if (!tileMatch) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const [, mapId, zStr, xStr, yStr] = tileMatch
      const z = parseInt(zStr)
      const x = parseInt(xStr)
      const y = parseInt(yStr)

      try {
        const tile = await this.getTile(mapId, z, x, y)
        if (tile) {
          res.writeHead(200, { 'Content-Type': 'image/png' })
          res.end(tile)
        } else {
          res.writeHead(404)
          res.end('Tile not found')
        }
      } catch (err) {
        console.error('Tile error:', err)
        res.writeHead(500)
        res.end('Server error')
      }
    })

    // Starte auf zufälligem Port
    this.tileServer.listen(0, '127.0.0.1', () => {
      const addr = this.tileServer?.address()
      if (addr && typeof addr === 'object') {
        this.tileServerPort = addr.port
        console.log(`Tile-Server gestartet auf Port ${this.tileServerPort}`)
      }
    })
  }

  /**
   * Gibt die Tile-Server URL zurück
   */
  getTileServerUrl(): string {
    return `http://127.0.0.1:${this.tileServerPort}`
  }

  // Cache für OZF Tile-Tabellen
  private ozfTileTableCache: Map<string, OZFTileTable> = new Map()

  /**
   * Extrahiert ein Tile - unterstützt sowohl OZF-Dateien als auch normale Bilder
   * Konvertiert Leaflet z/x/y Koordinaten zu Pixel-Koordinaten im Bild
   */
  async getTile(mapId: string, z: number, x: number, y: number): Promise<Buffer | null> {
    const map = this.maps.get(mapId)
    if (!map) {
      console.log('getTile: Map nicht gefunden', mapId)
      return null
    }

    // 1. Prüfe RAM-Cache
    const cacheKey = `${mapId}-${z}-${x}-${y}`
    if (this.tileCache.has(cacheKey)) {
      return this.tileCache.get(cacheKey)!
    }

    // 2. Prüfe Festplatten-Cache (persistent)
    const cachedTile = this.getCachedTile(mapId, z, x, y)
    if (cachedTile) {
      // In RAM-Cache laden für schnellen Zugriff
      if (this.tileCache.size >= this.MAX_CACHE_SIZE) {
        const firstKey = this.tileCache.keys().next().value
        if (firstKey) this.tileCache.delete(firstKey)
      }
      this.tileCache.set(cacheKey, cachedTile)
      return cachedTile
    }

    // 3. Tile extrahieren
    let tile: Buffer | null = null

    // Prüfe ob OZF-Datei vorhanden ist
    if (map.ozfPath && fs.existsSync(map.ozfPath)) {
      tile = await this.getTileFromOZF(map, z, x, y, cacheKey)
    } else {
      // Fallback: Normales Bild (JPG/PNG/TIFF)
      const imagePath = this.getImagePath(mapId)
      if (!imagePath || !fs.existsSync(imagePath)) {
        console.log('getTile: Kein Bild gefunden')
        return null
      }
      tile = await this.getTileFromImage(map, imagePath, z, x, y, cacheKey)
    }

    // 4. Speichere auf Festplatte für nächstes Mal
    if (tile) {
      this.saveTileToCache(mapId, z, x, y, tile)
    }

    return tile
  }

  /**
   * Extrahiere Tile direkt aus OZF-Datei (wie OziExplorer)
   */
  private async getTileFromOZF(
    map: LoadedMap,
    z: number,
    x: number,
    y: number,
    cacheKey: string
  ): Promise<Buffer | null> {
    try {
      const imgWidth = map.calibration.imageWidth
      const imgHeight = map.calibration.imageHeight
      const bounds = map.calibration.bounds

      // Leaflet Tile zu Pixel-Koordinaten
      const n = Math.pow(2, z)
      const tileLonWest = (x / n) * 360 - 180
      const tileLonEast = ((x + 1) / n) * 360 - 180
      const tileLatNorth = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
      const tileLatSouth = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI

      // Prüfe ob Tile die Karte schneidet
      if (tileLonEast < bounds.west || tileLonWest > bounds.east ||
          tileLatSouth > bounds.north || tileLatNorth < bounds.south) {
        return null
      }

      // Geo zu Pixel
      const geoWidth = bounds.east - bounds.west
      const geoHeight = bounds.north - bounds.south
      const pxPerDegLon = imgWidth / geoWidth
      const pxPerDegLat = imgHeight / geoHeight

      const pixelLeft = Math.max(0, (tileLonWest - bounds.west) * pxPerDegLon)
      const pixelRight = Math.min(imgWidth, (tileLonEast - bounds.west) * pxPerDegLon)
      const pixelTop = Math.max(0, (bounds.north - tileLatNorth) * pxPerDegLat)
      const pixelBottom = Math.min(imgHeight, (bounds.north - tileLatSouth) * pxPerDegLat)

      // OZF arbeitet mit 64x64 Tiles
      const ozfTileSize = 64
      const startTileX = Math.floor(pixelLeft / ozfTileSize)
      const startTileY = Math.floor(pixelTop / ozfTileSize)
      const endTileX = Math.ceil(pixelRight / ozfTileSize)
      const endTileY = Math.ceil(pixelBottom / ozfTileSize)

      // Lade Tile-Tabelle (cached)
      let tileTable = this.ozfTileTableCache.get(map.id)
      if (!tileTable) {
        tileTable = readOZF2TileTable(map.ozfPath) || undefined
        if (tileTable) {
          this.ozfTileTableCache.set(map.id, tileTable)
        }
      }

      if (!tileTable) {
        console.log('getTileFromOZF: Konnte Tile-Tabelle nicht lesen')
        return null
      }

      // Erstelle zusammengesetztes Bild aus OZF-Tiles
      const regionWidth = (endTileX - startTileX) * ozfTileSize
      const regionHeight = (endTileY - startTileY) * ozfTileSize

      // Sammle alle OZF-Tiles für diese Region
      const compositeImages: { input: Buffer; left: number; top: number }[] = []

      for (let ty = startTileY; ty < endTileY; ty++) {
        for (let tx = startTileX; tx < endTileX; tx++) {
          const tileData = extractOZF2Tile(map.ozfPath, tx, ty, tileTable)
          if (tileData && tileData.length >= ozfTileSize * ozfTileSize) {
            // Konvertiere indexed color zu RGB
            const rgbBuffer = Buffer.alloc(ozfTileSize * ozfTileSize * 3)
            for (let i = 0; i < ozfTileSize * ozfTileSize; i++) {
              const value = tileData[i]
              rgbBuffer[i * 3] = value
              rgbBuffer[i * 3 + 1] = value
              rgbBuffer[i * 3 + 2] = value
            }

            // Erstelle PNG aus den Rohdaten
            const tilePng = await sharp(rgbBuffer, {
              raw: { width: ozfTileSize, height: ozfTileSize, channels: 3 }
            }).png().toBuffer()

            compositeImages.push({
              input: tilePng,
              left: (tx - startTileX) * ozfTileSize,
              top: (ty - startTileY) * ozfTileSize
            })
          }
        }
      }

      if (compositeImages.length === 0) {
        return null
      }

      // Erstelle das zusammengesetzte Bild
      const compositeBuffer = await sharp({
        create: {
          width: regionWidth,
          height: regionHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
      })
        .composite(compositeImages)
        .png()
        .toBuffer()

      // Schneide den relevanten Bereich aus und skaliere auf Tile-Größe
      const cropLeft = Math.floor(pixelLeft) - startTileX * ozfTileSize
      const cropTop = Math.floor(pixelTop) - startTileY * ozfTileSize
      const cropWidth = Math.floor(pixelRight - pixelLeft)
      const cropHeight = Math.floor(pixelBottom - pixelTop)

      const tile = await sharp(compositeBuffer)
        .extract({
          left: Math.max(0, cropLeft),
          top: Math.max(0, cropTop),
          width: Math.min(cropWidth, regionWidth - cropLeft),
          height: Math.min(cropHeight, regionHeight - cropTop)
        })
        .resize(this.TILE_SIZE, this.TILE_SIZE, { fit: 'cover' })
        .png()
        .toBuffer()

      // Cache
      if (this.tileCache.size >= this.MAX_CACHE_SIZE) {
        const firstKey = this.tileCache.keys().next().value
        if (firstKey) this.tileCache.delete(firstKey)
      }
      this.tileCache.set(cacheKey, tile)

      return tile
    } catch (err) {
      console.error('getTileFromOZF Fehler:', err)
      return null
    }
  }

  /**
   * Extrahiere Tile aus Bild (JPG/PNG/TIFF)
   * Verwendet geotiff.js für große TIFFs (wie OziExplorer)
   */
  private async getTileFromImage(
    map: LoadedMap,
    imagePath: string,
    z: number,
    x: number,
    y: number,
    cacheKey: string
  ): Promise<Buffer | null> {
    try {
      const imgWidth = map.calibration.imageWidth
      const imgHeight = map.calibration.imageHeight
      const bounds = map.calibration.bounds

      // Leaflet Tile-Koordinaten zu Geo-Koordinaten (Web Mercator)
      const n = Math.pow(2, z)
      const tileLonWest = (x / n) * 360 - 180
      const tileLonEast = ((x + 1) / n) * 360 - 180
      const tileLatNorth = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
      const tileLatSouth = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI

      // Prüfe ob Tile die Karte schneidet
      if (tileLonEast < bounds.west || tileLonWest > bounds.east ||
          tileLatSouth > bounds.north || tileLatNorth < bounds.south) {
        return null
      }

      // PER-PIXEL REPROJEKTION (wie OziExplorer)
      // Für jeden Pixel im Tile berechnen wir die entsprechende Position im Quellbild
      const tile = await this.createReprojectedTile(
        imagePath,
        map.calibration,
        tileLonWest,
        tileLonEast,
        tileLatNorth,
        tileLatSouth,
        imgWidth,
        imgHeight
      )

      if (!tile) {
        return null
      }

      // RAM-Cache
      if (this.tileCache.size >= this.MAX_CACHE_SIZE) {
        const firstKey = this.tileCache.keys().next().value
        if (firstKey) this.tileCache.delete(firstKey)
      }
      this.tileCache.set(cacheKey, tile)

      // Festplatten-Cache für persistentes Caching
      this.saveTileToCache(map.id, z, x, y, tile)

      return tile
    } catch (err) {
      console.error(`Fehler beim Extrahieren von Tile ${x},${y},${z}:`, err)
      return null
    }
  }

  /**
   * Erstelle ein reprojiziertes Tile durch AFFINE Transformation
   * OPTIMIERT: Berechnet nur 4 Eckpunkte und nutzt Sharp's affine Transformation
   * statt 65.536 geoToPixel()-Aufrufe pro Tile
   */
  private async createReprojectedTile(
    imagePath: string,
    calibration: MapCalibration,
    lonWest: number,
    lonEast: number,
    latNorth: number,
    latSouth: number,
    imgWidth: number,
    imgHeight: number
  ): Promise<Buffer | null> {
    // Berechne NUR die 4 Eckpunkte (statt 65.536 Punkte!)
    const topLeftSrc = geoToPixel(latNorth, lonWest, calibration)
    const topRightSrc = geoToPixel(latNorth, lonEast, calibration)
    const bottomLeftSrc = geoToPixel(latSouth, lonWest, calibration)
    const bottomRightSrc = geoToPixel(latSouth, lonEast, calibration)

    // Finde die Bounding Box im Quellbild (mit Puffer)
    const allX = [topLeftSrc.x, topRightSrc.x, bottomLeftSrc.x, bottomRightSrc.x]
    const allY = [topLeftSrc.y, topRightSrc.y, bottomLeftSrc.y, bottomRightSrc.y]

    const srcLeft = Math.max(0, Math.floor(Math.min(...allX)) - 2)
    const srcRight = Math.min(imgWidth, Math.ceil(Math.max(...allX)) + 2)
    const srcTop = Math.max(0, Math.floor(Math.min(...allY)) - 2)
    const srcBottom = Math.min(imgHeight, Math.ceil(Math.max(...allY)) + 2)

    const srcWidth = srcRight - srcLeft
    const srcHeight = srcBottom - srcTop

    if (srcWidth <= 0 || srcHeight <= 0) {
      return null
    }

    // Berechne affine Transformation: Tile-Pixel → Quellbild-Pixel
    // Für Tile (0,0)→topLeft, (255,0)→topRight, (0,255)→bottomLeft
    // Affine: srcX = a*tileX + b*tileY + c, srcY = d*tileX + e*tileY + f
    const tileMax = this.TILE_SIZE - 1

    // Löse Gleichungssystem für X:
    // topLeft.x = a*0 + b*0 + c → c = topLeft.x
    // topRight.x = a*255 + b*0 + c → a = (topRight.x - c) / 255
    // bottomLeft.x = a*0 + b*255 + c → b = (bottomLeft.x - c) / 255
    const c = topLeftSrc.x - srcLeft
    const a = (topRightSrc.x - srcLeft - c) / tileMax
    const b = (bottomLeftSrc.x - srcLeft - c) / tileMax

    // Gleiches für Y:
    const f = topLeftSrc.y - srcTop
    const d = (topRightSrc.y - srcTop - f) / tileMax
    const e = (bottomLeftSrc.y - srcTop - f) / tileMax

    // Lade den relevanten Bereich des Quellbilds
    const srcImage = await sharp(imagePath, {
      limitInputPixels: false
    })
      .extract({
        left: srcLeft,
        top: srcTop,
        width: srcWidth,
        height: srcHeight
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { data: srcData } = srcImage
    const src = new Uint8Array(srcData.buffer, srcData.byteOffset, srcData.length)
    const srcRowStride = srcWidth * 4

    // Erstelle das Ziel-Tile mit affiner Transformation (Uint8Array für Geschwindigkeit)
    const tileData = new Uint8Array(this.TILE_SIZE * this.TILE_SIZE * 4)
    const tileSize = this.TILE_SIZE
    const srcWm1 = srcWidth - 1
    const srcHm1 = srcHeight - 1

    // Optimierte Schleife mit vorberechneten Werten pro Zeile
    for (let ty = 0; ty < tileSize; ty++) {
      // Startwerte für diese Zeile
      let localX = b * ty + c
      let localY = e * ty + f
      let tileIdx = ty * tileSize * 4

      for (let tx = 0; tx < tileSize; tx++) {
        if (localX >= 0 && localX < srcWm1 && localY >= 0 && localY < srcHm1) {
          // Bilineare Interpolation (entrollt für RGBA)
          const x0 = localX | 0  // Schneller als Math.floor für positive Zahlen
          const y0 = localY | 0
          const fx = localX - x0
          const fy = localY - y0
          const fx1 = 1 - fx
          const fy1 = 1 - fy

          const idx00 = y0 * srcRowStride + x0 * 4
          const idx10 = idx00 + 4
          const idx01 = idx00 + srcRowStride
          const idx11 = idx01 + 4

          // R
          tileData[tileIdx] = (fx1 * fy1 * src[idx00] + fx * fy1 * src[idx10] + fx1 * fy * src[idx01] + fx * fy * src[idx11]) | 0
          // G
          tileData[tileIdx + 1] = (fx1 * fy1 * src[idx00 + 1] + fx * fy1 * src[idx10 + 1] + fx1 * fy * src[idx01 + 1] + fx * fy * src[idx11 + 1]) | 0
          // B
          tileData[tileIdx + 2] = (fx1 * fy1 * src[idx00 + 2] + fx * fy1 * src[idx10 + 2] + fx1 * fy * src[idx01 + 2] + fx * fy * src[idx11 + 2]) | 0
          // A
          tileData[tileIdx + 3] = (fx1 * fy1 * src[idx00 + 3] + fx * fy1 * src[idx10 + 3] + fx1 * fy * src[idx01 + 3] + fx * fy * src[idx11 + 3]) | 0
        }
        // Transparent wenn außerhalb (Uint8Array ist bereits 0-initialisiert)

        localX += a  // Inkrementiere statt neu berechnen
        localY += d
        tileIdx += 4
      }
    }

    // Konvertiere zu PNG (Buffer.from für Sharp-Kompatibilität)
    return sharp(Buffer.from(tileData.buffer), {
      raw: { width: this.TILE_SIZE, height: this.TILE_SIZE, channels: 4 }
    })
      .png({ compressionLevel: 6 })
      .toBuffer()
  }

  /**
   * Extrahiere einen Ausschnitt aus einem TIFF mit geotiff.js
   * Dies lädt NUR den benötigten Bereich - nicht das ganze Bild!
   * Funktioniert wie OziExplorer mit großen Karten.
   */
  private async extractTileFromTIFF(
    tiffPath: string,
    left: number,
    top: number,
    width: number,
    height: number
  ): Promise<Buffer> {
    // Verwende Sharp mit extract() für TIFF-Regionen
    // Erhöhe das Speicherlimit für große TIFFs
    const tile = await sharp(tiffPath, {
      limitInputPixels: false,
      sequentialRead: true,  // Sequentielles Lesen für große Dateien
      failOn: 'none',        // Ignoriere Warnungen
      unlimited: true        // Kein Speicherlimit
    })
      .extract({
        left: left,
        top: top,
        width: width,
        height: height
      })
      .resize(this.TILE_SIZE, this.TILE_SIZE, {
        fit: 'cover',
        position: 'left top'
      })
      .png()
      .toBuffer()

    return tile
  }

  /**
   * Gibt Tile-Info für eine Karte zurück (für Leaflet TileLayer)
   * Enthält auch imageUrl für direktes Laden (bei JPEG/PNG)
   */
  getMapTileInfo(mapId: string): {
    tileUrl: string
    imageUrl: string  // Direkte URL zum Bild (für ImageOverlay)
    bounds: { north: number; south: number; east: number; west: number }
    maxZoom: number
    minZoom: number
    tileSize: number
    imageWidth: number
    imageHeight: number
  } | null {
    const map = this.maps.get(mapId)
    if (!map) return null

    const imgWidth = map.calibration.imageWidth
    const imgHeight = map.calibration.imageHeight

    // Berechne max Zoom basierend auf Bildgröße
    // Bei z=0 ist das ganze Bild in wenigen Tiles
    const maxDim = Math.max(imgWidth, imgHeight)
    const maxZoom = Math.ceil(Math.log2(maxDim / this.TILE_SIZE))

    // Hole Bildpfad für direktes Laden
    const imagePath = this.getImagePath(mapId)
    const ext = imagePath ? path.extname(imagePath).toLowerCase() : ''

    return {
      tileUrl: `${this.getTileServerUrl()}/tile/${mapId}/{z}/{x}/{y}.png`,
      imageUrl: `${this.getTileServerUrl()}/image/${mapId}${ext}`,  // z.B. /image/abc123.jpg
      bounds: map.calibration.bounds,
      maxZoom: Math.max(0, maxZoom),
      minZoom: 0,
      tileSize: this.TILE_SIZE,
      imageWidth: imgWidth,
      imageHeight: imgHeight
    }
  }

  /**
   * Stoppt den Tile-Server
   */
  stopTileServer(): void {
    if (this.tileServer) {
      this.tileServer.close()
      this.tileServer = null
      console.log('Tile-Server gestoppt')
    }
  }

  private ensureMapsDir(): void {
    if (!fs.existsSync(this.mapsDir)) {
      fs.mkdirSync(this.mapsDir, { recursive: true })
    }
  }

  private loadSavedMaps(): void {
    // Lade gespeicherte Kartenindex
    const indexPath = path.join(this.mapsDir, 'index.json')
    if (fs.existsSync(indexPath)) {
      try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))

        // Lade jede Karte aus dem Index
        for (const entry of index) {
          if (entry.mapPath && fs.existsSync(entry.mapPath)) {
            try {
              const calibration = parseMapFile(entry.mapPath)

              // Lade die Karte neu
              const loadedMap: LoadedMap = {
                id: entry.id,
                name: entry.name || calibration.title,
                calibration,
                ozfPath: entry.ozfPath || '',
                mapPath: entry.mapPath,
                tiles: new Map()
              }

              this.maps.set(entry.id, loadedMap)
            } catch (mapErr) {
              console.error('Fehler beim Laden der Karte:', entry.name, mapErr)
            }
          }
        }
      } catch (err) {
        console.error('Fehler beim Laden des Kartenindex:', err)
      }
    }
  }

  private saveMapIndex(): void {
    const indexPath = path.join(this.mapsDir, 'index.json')
    const index = Array.from(this.maps.values()).map(m => ({
      id: m.id,
      name: m.name,
      ozfPath: m.ozfPath,
      mapPath: m.mapPath,
      bounds: m.calibration.bounds
    }))
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
  }

  /**
   * Öffne Dialog zum Importieren einer OZF Karte
   */
  async importMap(): Promise<MapInfo | null> {
    const result = await dialog.showOpenDialog({
      title: 'OZF Karte importieren',
      filters: [
        { name: 'OziExplorer Karten', extensions: ['ozf2', 'ozf3', 'ozfx3'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    return this.addMap(result.filePaths[0])
  }

  /**
   * Füge eine Karte aus Pfad hinzu
   */
  async addMap(ozfPath: string): Promise<MapInfo | null> {
    try {
      const loadedMap = loadMap(ozfPath)
      if (!loadedMap) {
        throw new Error('Karte konnte nicht geladen werden')
      }

      // Kopiere Dateien in den Kartenordner
      const mapDir = path.join(this.mapsDir, loadedMap.id)
      fs.mkdirSync(mapDir, { recursive: true })

      // OZF Datei kopieren
      const newOzfPath = path.join(mapDir, path.basename(ozfPath))
      fs.copyFileSync(ozfPath, newOzfPath)
      loadedMap.ozfPath = newOzfPath

      // MAP Datei kopieren
      if (loadedMap.mapPath) {
        const newMapPath = path.join(mapDir, path.basename(loadedMap.mapPath))
        fs.copyFileSync(loadedMap.mapPath, newMapPath)
        loadedMap.mapPath = newMapPath
      }

      // Extrahiere das Bild aus der OZF (oder nutze existierendes)
      const imagePath = await this.extractImage(loadedMap, mapDir)

      this.maps.set(loadedMap.id, loadedMap)
      this.saveMapIndex()

      return {
        id: loadedMap.id,
        name: loadedMap.name,
        filename: path.basename(ozfPath),
        bounds: loadedMap.calibration.bounds,
        imageWidth: loadedMap.calibration.imageWidth,
        imageHeight: loadedMap.calibration.imageHeight,
        isLoaded: true,
        imagePath,
        cornerPoints: loadedMap.calibration.cornerPoints
      }
    } catch (err) {
      console.error('Fehler beim Importieren der Karte:', err)
      return null
    }
  }

  /**
   * Extrahiere das Bild aus der OZF Datei
   * OZF enthält komprimierte Bilddaten - hier vereinfachte Extraktion
   * TIFF-Dateien werden automatisch zu PNG konvertiert (Browser-Kompatibilität)
   */
  private async extractImage(map: LoadedMap, outputDir: string): Promise<string> {
    // Suche nach einem bereits vorhandenen Bild (PNG, JPG, BMP)
    const dir = path.dirname(map.ozfPath)
    const baseName = path.basename(map.ozfPath).replace(/\.ozf[x23]?$/i, '')

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff']

    for (const ext of imageExtensions) {
      const candidates = [
        path.join(dir, baseName + ext),
        path.join(dir, baseName + ext.toUpperCase()),
        path.join(dir, baseName.toLowerCase() + ext),
        path.join(dir, baseName.toUpperCase() + ext.toUpperCase())
      ]

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          // TIFF zu PNG konvertieren (Browser unterstützt kein TIFF)
          if (ext.toLowerCase() === '.tif' || ext.toLowerCase() === '.tiff') {
            const destPath = path.join(outputDir, 'map.png')
            try {
              await sharp(candidate)
                .png()
                .toFile(destPath)
              console.log('TIFF zu PNG konvertiert:', candidate, '->', destPath)
              return destPath
            } catch (err) {
              console.error('Fehler bei TIFF-Konvertierung:', err)
              // Fallback: Kopiere trotzdem
              const fallbackPath = path.join(outputDir, 'map' + ext)
              fs.copyFileSync(candidate, fallbackPath)
              return fallbackPath
            }
          }

          // Andere Formate direkt kopieren
          const destPath = path.join(outputDir, 'map' + ext)
          fs.copyFileSync(candidate, destPath)
          return destPath
        }
      }
    }

    // Fallback: Platzhalter erstellen
    // In einer vollständigen Implementation würde hier das OZF Format dekodiert
    const placeholderPath = path.join(outputDir, 'map.placeholder')
    fs.writeFileSync(placeholderPath, JSON.stringify({
      message: 'OZF Dekodierung erforderlich',
      width: map.calibration.imageWidth,
      height: map.calibration.imageHeight
    }))

    return placeholderPath
  }

  /**
   * Generiere alle Tiles für eine Karte im Voraus (wie OziExplorer)
   * Damit ist alles sofort da beim Zoomen - kein Nachladen!
   */
  private async pregenerateTiles(
    mapId: string,
    imagePath: string,
    imgWidth: number,
    imgHeight: number,
    bounds: { north: number; south: number; east: number; west: number }
  ): Promise<void> {
    console.log(`Generiere Tiles für ${mapId}...`)

    // Nur sinnvolle Zoom-Stufen (reduziert Tiles drastisch)
    const minZoom = 10
    const maxZoom = 15

    let totalTiles = 0
    let generatedTiles = 0

    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z)

      // Berechne Tile-Bereich für diese Zoom-Stufe
      const minTileX = Math.floor((bounds.west + 180) / 360 * n)
      const maxTileX = Math.floor((bounds.east + 180) / 360 * n)
      const minTileY = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
      const maxTileY = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)

      totalTiles += (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1)
    }

    console.log(`Generiere ${totalTiles} Tiles...`)

    // Lade das Bild einmal
    const ext = path.extname(imagePath).toLowerCase()

    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z)

      const minTileX = Math.floor((bounds.west + 180) / 360 * n)
      const maxTileX = Math.floor((bounds.east + 180) / 360 * n)
      const minTileY = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
      const maxTileY = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)

      for (let x = minTileX; x <= maxTileX; x++) {
        for (let y = minTileY; y <= maxTileY; y++) {
          // Prüfe ob schon gecacht
          if (this.getCachedTile(mapId, z, x, y)) {
            generatedTiles++
            continue
          }

          try {
            // Berechne Pixel-Koordinaten
            const tileLonWest = (x / n) * 360 - 180
            const tileLonEast = ((x + 1) / n) * 360 - 180
            const tileLatNorth = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
            const tileLatSouth = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI

            const geoWidth = bounds.east - bounds.west
            const geoHeight = bounds.north - bounds.south
            const pxPerDegLon = imgWidth / geoWidth
            const pxPerDegLat = imgHeight / geoHeight

            const pixelLeft = Math.max(0, Math.floor((tileLonWest - bounds.west) * pxPerDegLon))
            const pixelRight = Math.min(imgWidth, Math.ceil((tileLonEast - bounds.west) * pxPerDegLon))
            const pixelTop = Math.max(0, Math.floor((bounds.north - tileLatNorth) * pxPerDegLat))
            const pixelBottom = Math.min(imgHeight, Math.ceil((bounds.north - tileLatSouth) * pxPerDegLat))

            const extractWidth = pixelRight - pixelLeft
            const extractHeight = pixelBottom - pixelTop

            if (extractWidth > 0 && extractHeight > 0) {
              const tile = await sharp(imagePath, {
                limitInputPixels: false,
                sequentialRead: true,
                failOn: 'none',
                unlimited: true
              })
                .extract({
                  left: pixelLeft,
                  top: pixelTop,
                  width: extractWidth,
                  height: extractHeight
                })
                .resize(this.TILE_SIZE, this.TILE_SIZE, {
                  fit: 'cover',
                  position: 'left top'
                })
                .png()
                .toBuffer()

              this.saveTileToCache(mapId, z, x, y, tile)
            }
          } catch (err) {
            // Ignoriere Fehler bei einzelnen Tiles
          }

          generatedTiles++
          if (generatedTiles % 50 === 0) {
            console.log(`Tiles: ${generatedTiles}/${totalTiles} (${Math.round(generatedTiles/totalTiles*100)}%)`)
          }
        }
      }
    }

    console.log(`Tile-Generierung abgeschlossen: ${generatedTiles} Tiles`)
  }

  /**
   * Prüfe ob Tiles für eine Karte bereits gecacht sind
   */
  areTilesCached(mapId: string): boolean {
    const cacheDir = path.join(this.tileCacheDir, mapId)
    if (!fs.existsSync(cacheDir)) return false

    // Prüfe ob mindestens einige Tiles existieren
    try {
      const zoomDirs = fs.readdirSync(cacheDir)
      return zoomDirs.length > 5 // Mindestens 5 Zoom-Stufen
    } catch {
      return false
    }
  }

  /**
   * Generiere Tiles mit Fortschritts-Callback (für Ladebalken)
   */
  async prepareTilesWithProgress(
    mapId: string,
    onProgress: (progress: number, total: number) => void
  ): Promise<boolean> {
    const map = this.maps.get(mapId)
    if (!map) return false

    const imagePath = this.getImagePath(mapId)
    if (!imagePath || !fs.existsSync(imagePath)) return false

    const imgWidth = map.calibration.imageWidth
    const imgHeight = map.calibration.imageHeight
    const bounds = map.calibration.bounds

    console.log(`Generiere Tiles für ${mapId} mit Fortschritt...`)

    // Nur die wichtigsten Zoom-Stufen - höhere Stufen werden on-demand geladen
    // Zoom 10-14 deckt typische Ballonfahrt-Ansichten ab
    const minZoom = 10
    const maxZoom = 14

    // Zähle Tiles
    let totalTiles = 0
    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z)
      const minTileX = Math.floor((bounds.west + 180) / 360 * n)
      const maxTileX = Math.floor((bounds.east + 180) / 360 * n)
      const minTileY = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
      const maxTileY = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)
      totalTiles += (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1)
    }

    let generatedTiles = 0
    onProgress(0, totalTiles)

    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z)
      const minTileX = Math.floor((bounds.west + 180) / 360 * n)
      const maxTileX = Math.floor((bounds.east + 180) / 360 * n)
      const minTileY = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
      const maxTileY = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)

      for (let x = minTileX; x <= maxTileX; x++) {
        for (let y = minTileY; y <= maxTileY; y++) {
          // Prüfe ob schon gecacht
          if (this.getCachedTile(mapId, z, x, y)) {
            generatedTiles++
            if (generatedTiles % 20 === 0) onProgress(generatedTiles, totalTiles)
            continue
          }

          try {
            // Verwende getTileFromImage für korrekte UTM-Transformation
            const cacheKey = `${mapId}-${z}-${x}-${y}`
            const tile = await this.getTileFromImage(map, imagePath, z, x, y, cacheKey)

            if (tile) {
              this.saveTileToCache(mapId, z, x, y, tile)
            }
          } catch (err) {
            // Ignoriere Fehler bei einzelnen Tiles
          }

          generatedTiles++
          if (generatedTiles % 20 === 0) onProgress(generatedTiles, totalTiles)
        }
      }
    }

    onProgress(totalTiles, totalTiles)
    console.log(`Tile-Generierung abgeschlossen: ${generatedTiles} Tiles`)
    return true
  }

  /**
   * Importiere eine Karte mit separatem Bild
   * Für Fälle wo das Bild bereits als PNG/JPG vorliegt
   * TIFF-Dateien werden automatisch zu JPEG konvertiert
   * @param onProgress - Callback für Fortschrittsanzeige (status, percent)
   */
  async importMapWithImage(
    mapFilePath: string,
    imagePath: string,
    onProgress?: (status: string, percent: number) => void
  ): Promise<MapInfo | null> {
    const progress = onProgress || (() => {})

    try {
      progress('Lese Kalibrierungsdaten...', 5)
      // MAP Datei parsen
      const calibration = parseMapFile(mapFilePath)

      // Verwende Hash des Pfads als ID - so bleibt der Tile-Cache persistent
      const id = cryptoNode.createHash('md5').update(mapFilePath.toLowerCase()).digest('hex').substring(0, 16)
      const mapDir = path.join(this.mapsDir, id)
      fs.mkdirSync(mapDir, { recursive: true })

      progress('Kopiere Kalibrierungsdatei...', 10)
      // MAP Datei kopieren
      const newMapPath = path.join(mapDir, path.basename(mapFilePath))
      fs.copyFileSync(mapFilePath, newMapPath)

      // Bild verarbeiten - TIFF zu JPEG konvertieren falls nötig
      const ext = path.extname(imagePath).toLowerCase()
      let newImagePath: string

      if (ext === '.tif' || ext === '.tiff') {
        // TIFF zu JPEG konvertieren - einmalig beim Import
        // Danach lädt die Karte sofort ohne Tiles/Neuladen
        newImagePath = path.join(mapDir, 'map.jpg')
        console.log('Konvertiere TIFF zu JPEG...')

        try {
          progress('Lese TIFF-Metadaten...', 15)
          // Ermittle Bildgröße zuerst
          const metadata = await sharp(imagePath, { limitInputPixels: false }).metadata()
          const originalWidth = metadata.width || 0
          const originalHeight = metadata.height || 0

          console.log(`TIFF Größe: ${originalWidth} x ${originalHeight}`)

          if (!calibration.imageWidth || !calibration.imageHeight) {
            calibration.imageWidth = originalWidth
            calibration.imageHeight = originalHeight
          }

          // Konvertiere TIFF zu JPEG mit hoher Qualität
          // Dies reduziert ~840MB TIFF auf ~50-100MB JPEG
          progress('Konvertiere TIFF zu JPEG... (kann etwas dauern)', 20)
          console.log('Starte Konvertierung...')

          // Simuliere Fortschritt während der Konvertierung
          let fakeProgress = 20
          const progressInterval = setInterval(() => {
            fakeProgress = Math.min(fakeProgress + 5, 85)
            progress('Konvertiere TIFF zu JPEG...', fakeProgress)
          }, 2000)

          await sharp(imagePath, {
            limitInputPixels: false,
            sequentialRead: true,
            failOn: 'none',
            unlimited: true
          })
            .jpeg({
              quality: 92,           // Hohe Qualität
              mozjpeg: true,         // Bessere Kompression
              chromaSubsampling: '4:4:4'  // Keine Farbuntertastung für Karten
            })
            .toFile(newImagePath)

          clearInterval(progressInterval)
          progress('Konvertierung abgeschlossen', 90)

          const jpegStats = fs.statSync(newImagePath)
          console.log(`JPEG erstellt: ${Math.round(jpegStats.size / 1024 / 1024)}MB`)
        } catch (err) {
          console.error('Fehler bei TIFF-Konvertierung:', err)
          progress('Fallback: Kopiere TIFF direkt...', 85)
          // Fallback: TIFF direkt kopieren
          newImagePath = path.join(mapDir, 'map.tif')
          fs.copyFileSync(imagePath, newImagePath)
        }
      } else {
        progress('Kopiere Bilddatei...', 50)
        // Andere Formate direkt kopieren
        newImagePath = path.join(mapDir, 'map' + ext)
        fs.copyFileSync(imagePath, newImagePath)

        // Bildabmessungen ermitteln falls nicht in .map vorhanden
        if (!calibration.imageWidth || !calibration.imageHeight) {
          try {
            const metadata = await sharp(imagePath).metadata()
            calibration.imageWidth = metadata.width || 0
            calibration.imageHeight = metadata.height || 0
            console.log('Bildabmessungen ermittelt:', calibration.imageWidth, 'x', calibration.imageHeight)
          } catch (err) {
            console.error('Fehler beim Lesen der Bildabmessungen:', err)
          }
        }
        progress('Bilddatei kopiert', 90)
      }

      progress('Speichere Kartenindex...', 95)
      const loadedMap: LoadedMap = {
        id,
        name: calibration.title || path.basename(mapFilePath, '.map'),
        calibration,
        ozfPath: '',
        mapPath: newMapPath,
        tiles: new Map()
      }

      this.maps.set(id, loadedMap)
      this.saveMapIndex()

      progress('Fertig!', 100)
      return {
        id,
        name: loadedMap.name,
        filename: path.basename(mapFilePath),
        bounds: calibration.bounds,
        imageWidth: calibration.imageWidth,
        imageHeight: calibration.imageHeight,
        isLoaded: true,
        imagePath: newImagePath,
        cornerPoints: calibration.cornerPoints
      }
    } catch (err) {
      console.error('Fehler beim Importieren:', err)
      progress('Fehler beim Import', 0)
      return null
    }
  }

  /**
   * Liste aller importierten Karten
   */
  getMapList(): MapInfo[] {
    return Array.from(this.maps.values()).map(m => ({
      id: m.id,
      name: m.name,
      filename: path.basename(m.ozfPath || m.mapPath),
      bounds: m.calibration.bounds,
      imageWidth: m.calibration.imageWidth,
      imageHeight: m.calibration.imageHeight,
      isLoaded: true,
      imagePath: this.getImagePath(m.id),
      cornerPoints: m.calibration.cornerPoints,
      hasTiles: this.hasMapTiles(m.id),
      utmZone: m.calibration.utmCalibration?.zone
    }))
  }

  /**
   * Hole eine Karte nach ID
   */
  getMapById(mapId: string): MapInfo | null {
    const m = this.maps.get(mapId)
    if (!m) return null

    return {
      id: m.id,
      name: m.name,
      filename: path.basename(m.ozfPath || m.mapPath),
      bounds: m.calibration.bounds,
      imageWidth: m.calibration.imageWidth,
      imageHeight: m.calibration.imageHeight,
      isLoaded: true,
      imagePath: this.getImagePath(m.id),
      cornerPoints: m.calibration.cornerPoints,
      hasTiles: this.hasMapTiles(m.id),
      utmZone: m.calibration.utmCalibration?.zone
    }
  }

  /**
   * Hole Bildpfad für eine Karte
   */
  getImagePath(mapId: string): string {
    const mapDir = path.join(this.mapsDir, mapId)

    // Bevorzuge konvertierte Formate vor TIFF
    const extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff']
    for (const ext of extensions) {
      const imgPath = path.join(mapDir, 'map' + ext)
      if (fs.existsSync(imgPath)) {
        console.log('getImagePath:', imgPath)
        return imgPath
      }
    }

    console.log('getImagePath: Kein Bild gefunden in', mapDir)
    return ''
  }

  /**
   * Hole Bild als Base64 Data-URL für eine Karte
   * Das Bild wird einmal geladen und bleibt im Speicher - kein HTTP, kein Neuladen!
   */
  async getImageAsDataUrl(mapId: string): Promise<string> {
    const imagePath = this.getImagePath(mapId)
    if (!imagePath) return ''

    try {
      const ext = path.extname(imagePath).toLowerCase()

      // TIFF sollte beim Import zu JPG konvertiert worden sein
      if (ext === '.tif' || ext === '.tiff') {
        console.error(`TIFF-Datei gefunden - sollte zu JPG konvertiert sein`)
        throw new Error('TIFF nicht unterstützt - bitte Karte neu importieren')
      }

      // Lade Bild direkt von Festplatte als Base64
      // Einmal geladen, bleibt es im Browser-Speicher
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.bmp': 'image/bmp'
      }
      const mimeType = mimeTypes[ext] || 'image/jpeg'

      console.log('Lade Bild von Festplatte:', imagePath)
      const imageBuffer = fs.readFileSync(imagePath)
      const base64 = imageBuffer.toString('base64')
      console.log(`Bild geladen: ${Math.round(imageBuffer.length / 1024 / 1024)}MB`)

      return `data:${mimeType};base64,${base64}`
    } catch (err: any) {
      console.error('Fehler beim Lesen des Bildes:', err)
      throw err
    }
  }

  /**
   * Konvertiere Geo-Koordinaten zu Bildpixeln
   */
  geoToPixel(mapId: string, lat: number, lon: number): { x: number; y: number } | null {
    const map = this.maps.get(mapId)
    if (!map) return null
    return geoToPixel(lat, lon, map.calibration)
  }

  /**
   * Konvertiere Bildpixel zu Geo-Koordinaten
   */
  pixelToGeo(mapId: string, x: number, y: number): { lat: number; lon: number } | null {
    const map = this.maps.get(mapId)
    if (!map) return null
    return pixelToGeo(x, y, map.calibration)
  }

  /**
   * Transformiere WGS84-Koordinaten zu Display-Koordinaten für das reprojizierte Bild.
   * Problem: OZI-Karten haben UTM-Koordinaten. Wenn wir das Bild in Leaflet als
   * rechteckiges WGS84-Overlay anzeigen, sind die Koordinaten verzerrt (Trapezform).
   * Diese Funktion berechnet die korrekte Position auf dem Leaflet-Overlay.
   *
   * Transformation: WGS84 → UTM → Pixel → Display-WGS84 (linear über Bounds)
   */
  geoToDisplayCoord(mapId: string, lat: number, lon: number): { lat: number; lon: number } | null {
    const map = this.maps.get(mapId)
    if (!map) return null

    // 1. WGS84 → Pixel (verwendet UTM-Transformation wenn verfügbar)
    const pixel = geoToPixel(lat, lon, map.calibration)
    if (!pixel) return null

    // 2. Pixel → Display-WGS84 (linear interpoliert über Bounds)
    // Das reprojizierte Bild verwendet diese linearen Bounds
    const bounds = map.calibration.bounds
    const imgWidth = map.calibration.imageWidth
    const imgHeight = map.calibration.imageHeight

    // Normalisierte Pixel-Position (0-1)
    const u = pixel.x / imgWidth
    const v = pixel.y / imgHeight

    // Linear interpolierte Display-Koordinaten
    const displayLat = bounds.north - v * (bounds.north - bounds.south)
    const displayLon = bounds.west + u * (bounds.east - bounds.west)

    return { lat: displayLat, lon: displayLon }
  }

  /**
   * Lösche eine Karte
   */
  removeMap(mapId: string): boolean {
    const map = this.maps.get(mapId)
    if (!map) return false

    // Dateien löschen
    const mapDir = path.join(this.mapsDir, mapId)
    if (fs.existsSync(mapDir)) {
      fs.rmSync(mapDir, { recursive: true })
    }

    this.maps.delete(mapId)
    this.saveMapIndex()
    return true
  }

  /**
   * Prüfe ob eine Karte den angegebenen Bereich abdeckt
   */
  coversArea(mapId: string, lat: number, lon: number): boolean {
    const map = this.maps.get(mapId)
    if (!map) return false

    const bounds = map.calibration.bounds
    return lat >= bounds.south &&
           lat <= bounds.north &&
           lon >= bounds.west &&
           lon <= bounds.east
  }

  /**
   * Finde alle Karten die einen Punkt abdecken
   */
  findMapsForLocation(lat: number, lon: number): MapInfo[] {
    return this.getMapList().filter(m => this.coversArea(m.id, lat, lon))
  }

  /**
   * Aktualisiere die Kalibrierung einer Karte
   */
  updateCalibration(
    mapId: string,
    points: Array<{
      pixelX: number
      pixelY: number
      latitude: number
      longitude: number
    }>
  ): boolean {
    try {
      console.log('updateCalibration aufgerufen für:', mapId)
      console.log('Anzahl Punkte:', points.length)
      console.log('Punkte:', JSON.stringify(points, null, 2))

      const map = this.maps.get(mapId)
      if (!map) {
        console.error('Karte nicht gefunden:', mapId)
        console.log('Verfügbare Karten:', Array.from(this.maps.keys()))
        return false
      }

      if (points.length < 2) {
        console.error('Mindestens 2 Kalibrierungspunkte erforderlich')
        return false
      }

      // Kalibrierungspunkte aktualisieren
      map.calibration.calibrationPoints = points

      // Bounds neu berechnen durch Transformation der 4 Bildecken
      const tempCalibration = { ...map.calibration, calibrationPoints: points }

      console.log('Berechne Bounds für Bildecken...')
      const corners = [
        pixelToGeo(0, 0, tempCalibration),
        pixelToGeo(map.calibration.imageWidth, 0, tempCalibration),
        pixelToGeo(0, map.calibration.imageHeight, tempCalibration),
        pixelToGeo(map.calibration.imageWidth, map.calibration.imageHeight, tempCalibration)
      ]

      console.log('Ecken berechnet:', corners)

      const north = Math.max(...corners.map(c => c.lat))
      const south = Math.min(...corners.map(c => c.lat))
      const east = Math.max(...corners.map(c => c.lon))
      const west = Math.min(...corners.map(c => c.lon))

      map.calibration.bounds = { north, south, east, west }

      console.log('Neue Bounds:', map.calibration.bounds)

      // MAP Datei speichern
      this.saveMapFile(mapId)
      this.saveMapIndex()

      console.log('Kalibrierung erfolgreich gespeichert')
      return true
    } catch (err) {
      console.error('Fehler in updateCalibration:', err)
      return false
    }
  }

  /**
   * Speichere MAP Datei mit aktualisierter Kalibrierung
   */
  private saveMapFile(mapId: string): void {
    const map = this.maps.get(mapId)
    if (!map) return

    // Erstelle MAP Datei Pfad wenn nicht vorhanden
    if (!map.mapPath) {
      const mapDir = path.join(this.mapsDir, mapId)
      if (!fs.existsSync(mapDir)) {
        fs.mkdirSync(mapDir, { recursive: true })
      }
      map.mapPath = path.join(mapDir, 'calibration.map')
    }

    const cal = map.calibration
    const lines: string[] = []

    // OziExplorer MAP Format
    lines.push('OziExplorer Map Data File Version 2.2')
    lines.push(cal.title || map.name)
    lines.push(map.imagePath ? path.basename(map.imagePath) : cal.imagePath || 'map.png')
    lines.push('1 ,Map Code,')
    lines.push(`${cal.datum},WGS 84, 0.0, 0.0,WGS 84`)
    lines.push('Reserved 1')
    lines.push('Reserved 2')
    lines.push('Magnetic Variation,,,E')
    lines.push(`Map Projection,${cal.projection},PolyCal,No,AutoCalOnly,No,BSBUseWPX,No`)

    // Kalibrierungspunkte (30 Stück)
    for (let i = 0; i < 30; i++) {
      const point = cal.calibrationPoints[i]
      const num = (i + 1).toString().padStart(2, '0')

      if (point) {
        const latDir = point.latitude >= 0 ? 'N' : 'S'
        const lonDir = point.longitude >= 0 ? 'E' : 'W'
        const latAbs = Math.abs(point.latitude)
        const lonAbs = Math.abs(point.longitude)

        const latDeg = Math.floor(latAbs)
        const latMin = Math.floor((latAbs - latDeg) * 60)
        const latSec = ((latAbs - latDeg) * 60 - latMin) * 60

        const lonDeg = Math.floor(lonAbs)
        const lonMin = Math.floor((lonAbs - lonDeg) * 60)
        const lonSec = ((lonAbs - lonDeg) * 60 - lonMin) * 60

        lines.push(`Point${num},xy,${point.pixelX},${point.pixelY},in,deg,${latDeg},${latMin},${latSec.toFixed(3)},${latDir},${lonDeg},${lonMin},${lonSec.toFixed(3)},${lonDir},grid,,,,,N`)
      } else {
        lines.push(`Point${num},xy,,,in,deg,,,,,N,,,,,E,grid,,,,,N`)
      }
    }

    lines.push('Projection Setup,,,,,,,,,,')
    lines.push('Map Feature = MF ; Map Comment = MC     These follow if they exist')
    lines.push('Track File = TF      These follow if they exist')
    lines.push('Moving Map Parameters = MM?    These follow if they exist')
    lines.push('MM0,Yes')
    lines.push('MMPNUM,4')
    lines.push(`MMPXY,1,0,0`)
    lines.push(`MMPXY,2,${cal.imageWidth},0`)
    lines.push(`MMPXY,3,${cal.imageWidth},${cal.imageHeight}`)
    lines.push(`MMPXY,4,0,${cal.imageHeight}`)
    lines.push(`MMPLL,1,${cal.bounds.west.toFixed(6)},${cal.bounds.north.toFixed(6)}`)
    lines.push(`MMPLL,2,${cal.bounds.east.toFixed(6)},${cal.bounds.north.toFixed(6)}`)
    lines.push(`MMPLL,3,${cal.bounds.east.toFixed(6)},${cal.bounds.south.toFixed(6)}`)
    lines.push(`MMPLL,4,${cal.bounds.west.toFixed(6)},${cal.bounds.south.toFixed(6)}`)
    lines.push(`IWH,Map Image Width/Height,${cal.imageWidth},${cal.imageHeight}`)

    try {
      fs.writeFileSync(map.mapPath, lines.join('\r\n'))
      console.log('MAP Datei gespeichert:', map.mapPath)
    } catch (err) {
      console.error('Fehler beim Speichern der MAP Datei:', err)
    }
  }
}

// Singleton Export
let mapManagerInstance: MapManager | null = null

export function getMapManager(): MapManager {
  if (!mapManagerInstance) {
    mapManagerInstance = new MapManager()
  }
  return mapManagerInstance
}
