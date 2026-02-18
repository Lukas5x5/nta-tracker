import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import * as https from 'https'
import * as http from 'http'
import sharp from 'sharp'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore sql.js has no type declarations
import initSqlJs from 'sql.js'

interface CacheStats {
  totalTiles: number
  totalSize: number // in bytes
  providers: { [key: string]: number }
}

interface TileCoord {
  z: number
  x: number
  y: number
}

interface DownloadProgress {
  total: number
  downloaded: number
  cached: number
  failed: number
  currentTile: string
}

interface BoundsDownloadResult {
  success: boolean
  tilesDownloaded: number
  tilesCached: number
  tilesFailed: number
  totalSize: number
}

export interface MBTilesImportResult {
  success: boolean
  tilesImported: number
  tilesSkipped: number
  tilesFailed: number
  totalSize: number
  bounds: { north: number; south: number; east: number; west: number } | null
  minZoom: number
  maxZoom: number
  name: string
}

export interface MBTilesImportProgress {
  total: number
  imported: number
  skipped: number
  failed: number
  currentTile: string
  phase: 'reading' | 'importing' | 'done'
}

export class TileCacheManager {
  private cacheDir: string
  private maxCacheSize: number = 10 * 1024 * 1024 * 1024 // 10 GB max

  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'tile-cache')
    this.ensureCacheDir()
    this.migrateOldProviderNames()
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  // Migriere alte Provider-Ordnernamen (z.B. "osm" → "openstreetmap")
  // damit bereits gecachte Tiles unter dem neuen Namen gefunden werden
  private migrateOldProviderNames() {
    const migrations: Record<string, string> = {
      'osm': 'openstreetmap'
    }
    for (const [oldName, newName] of Object.entries(migrations)) {
      const oldDir = path.join(this.cacheDir, oldName)
      const newDir = path.join(this.cacheDir, newName)
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        try {
          fs.renameSync(oldDir, newDir)
          console.log(`[TileCache] Migriert: ${oldName} → ${newName}`)
        } catch (err) {
          console.error(`[TileCache] Migration fehlgeschlagen: ${oldName} → ${newName}`, err)
        }
      }
    }
  }

  // Generiere einen eindeutigen Dateinamen für einen Tile
  private getTilePath(provider: string, z: number, x: number, y: number): string {
    const providerDir = path.join(this.cacheDir, this.sanitizeProvider(provider))
    const zDir = path.join(providerDir, z.toString())
    const xDir = path.join(zDir, x.toString())
    return path.join(xDir, `${y}.png`)
  }

  private sanitizeProvider(provider: string): string {
    // URL zu sicherem Ordnernamen konvertieren
    return provider
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50)
  }

  // Prüfe ob Tile im Cache ist
  async hasTile(provider: string, z: number, x: number, y: number): Promise<boolean> {
    const tilePath = this.getTilePath(provider, z, x, y)
    return fs.existsSync(tilePath)
  }

  // Hole Tile aus Cache als Base64 Data URL
  async getTile(provider: string, z: number, x: number, y: number): Promise<string | null> {
    const tilePath = this.getTilePath(provider, z, x, y)

    if (!fs.existsSync(tilePath)) {
      return null
    }

    try {
      const data = fs.readFileSync(tilePath)

      // Korrupte/leere Tiles verwerfen und aus Cache löschen
      if (data.length < 100) {
        fs.unlinkSync(tilePath)
        return null
      }

      // MIME-Type korrekt erkennen
      const isJpeg = data[0] === 0xFF && data[1] === 0xD8
      const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47
      if (!isPng && !isJpeg) {
        // Keine gültige Bilddatei → aus Cache löschen
        fs.unlinkSync(tilePath)
        return null
      }

      const mimeType = isJpeg ? 'image/jpeg' : 'image/png'
      return `data:${mimeType};base64,${data.toString('base64')}`
    } catch (error) {
      console.error('Error reading cached tile:', error)
      return null
    }
  }

  // Speichere Tile im Cache
  async saveTile(provider: string, z: number, x: number, y: number, data: Buffer): Promise<boolean> {
    const tilePath = this.getTilePath(provider, z, x, y)
    const dir = path.dirname(tilePath)

    try {
      // Erstelle Verzeichnisstruktur
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(tilePath, data)
      return true
    } catch (error) {
      console.error('Error saving tile to cache:', error)
      return false
    }
  }

  // Speichere Tile im Cache aus Base64-String (vom Renderer)
  async saveTileBase64(provider: string, z: number, x: number, y: number, base64Data: string): Promise<boolean> {
    try {
      const buffer = Buffer.from(base64Data, 'base64')
      return this.saveTile(provider, z, x, y, buffer)
    } catch (error) {
      console.error('Error saving base64 tile to cache:', error)
      return false
    }
  }

  // Lade Tile von URL und speichere im Cache
  async fetchAndCacheTile(url: string, provider: string, z: number, x: number, y: number): Promise<string | null> {
    // Erst prüfen ob im Cache
    const cached = await this.getTile(provider, z, x, y)
    if (cached) {
      return cached
    }

    // Sonst von URL laden
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http

      // Parse URL für Options
      const urlObj = new URL(url)
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'User-Agent': 'NTA-Balloon-Navigator/1.0 (Electron; Ballooning Navigation App)',
          'Accept': 'image/png,image/*',
          'Referer': 'https://nta-balloon-navigator.app'
        }
      }

      const request = protocol.get(options, (response) => {
        // Folge Redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            this.fetchAndCacheTile(redirectUrl, provider, z, x, y).then(resolve)
            return
          }
        }

        if (response.statusCode !== 200) {
          resolve(null)
          return
        }

        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        response.on('end', async () => {
          const buffer = Buffer.concat(chunks)

          // Validiere: Mindestens 100 Bytes (leere/korrupte Tiles verwerfen)
          // und muss mit PNG-Header (89 50 4E 47) oder JPEG-Header (FF D8) beginnen
          if (buffer.length < 100) {
            resolve(null)
            return
          }
          const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
          const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8
          if (!isPng && !isJpeg) {
            // Keine gültige Bilddatei (z.B. HTML-Fehlerseite)
            resolve(null)
            return
          }

          // Im Cache speichern
          await this.saveTile(provider, z, x, y, buffer)

          // Als Data URL zurückgeben
          const mimeType = isJpeg ? 'image/jpeg' : 'image/png'
          resolve(`data:${mimeType};base64,${buffer.toString('base64')}`)
        })

        response.on('error', () => {
          resolve(null)
        })
      })

      request.on('error', () => {
        resolve(null)
      })

      // Timeout nach 10 Sekunden
      request.setTimeout(10000, () => {
        request.destroy()
        resolve(null)
      })
    })
  }

  // Cache-Statistiken abrufen
  async getStats(): Promise<CacheStats> {
    const stats: CacheStats = {
      totalTiles: 0,
      totalSize: 0,
      providers: {}
    }

    if (!fs.existsSync(this.cacheDir)) {
      return stats
    }

    const countFiles = (dir: string, provider: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            countFiles(fullPath, provider)
          } else if (entry.isFile()) {
            const fileStats = fs.statSync(fullPath)
            stats.totalTiles++
            stats.totalSize += fileStats.size
            stats.providers[provider] = (stats.providers[provider] || 0) + 1
          }
        }
      } catch (error) {
        // Ignoriere Fehler bei nicht lesbaren Verzeichnissen
      }
    }

    try {
      const providers = fs.readdirSync(this.cacheDir, { withFileTypes: true })
      for (const provider of providers) {
        if (provider.isDirectory()) {
          countFiles(path.join(this.cacheDir, provider.name), provider.name)
        }
      }
    } catch (error) {
      console.error('Error getting cache stats:', error)
    }

    return stats
  }

  // Cache leeren
  async clearCache(provider?: string): Promise<boolean> {
    try {
      if (provider) {
        // Nur bestimmten Provider löschen
        const providerDir = path.join(this.cacheDir, this.sanitizeProvider(provider))
        if (fs.existsSync(providerDir)) {
          fs.rmSync(providerDir, { recursive: true, force: true })
        }
      } else {
        // Gesamten Cache löschen
        if (fs.existsSync(this.cacheDir)) {
          fs.rmSync(this.cacheDir, { recursive: true, force: true })
          this.ensureCacheDir()
        }
      }
      return true
    } catch (error) {
      console.error('Error clearing cache:', error)
      return false
    }
  }

  // Cache-Verzeichnis ermitteln
  getCacheDirectory(): string {
    return this.cacheDir
  }

  // ==========================================
  // COMPETITION AREA DOWNLOAD FUNCTIONS
  // ==========================================

  // Berechne Tile-Koordinaten für ein Lat/Lon bei gegebenem Zoom
  private latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
    const n = Math.pow(2, zoom)
    const x = Math.floor((lon + 180) / 360 * n)
    const latRad = lat * Math.PI / 180
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) }
  }

  // Generiere Liste aller Tiles für ein Polygon (4 Eckpunkte)
  getTilesForPolygon(
    points: Array<{ lat: number; lon: number }>,
    minZoom: number,
    maxZoom: number
  ): TileCoord[] {
    const tiles: TileCoord[] = []

    // Berechne Bounding Box des Polygons
    const lats = points.map(p => p.lat)
    const lons = points.map(p => p.lon)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)

    for (let z = minZoom; z <= maxZoom; z++) {
      const topLeft = this.latLonToTile(maxLat, minLon, z)
      const bottomRight = this.latLonToTile(minLat, maxLon, z)

      for (let x = topLeft.x; x <= bottomRight.x; x++) {
        for (let y = topLeft.y; y <= bottomRight.y; y++) {
          tiles.push({ z, x, y })
        }
      }
    }

    return tiles
  }

  // Schätze Download-Größe (ca. 15 KB pro Tile)
  estimateDownloadSize(tileCount: number): number {
    return tileCount * 15 * 1024 // ~15 KB pro Tile
  }

  // Download alle Tiles für einen Bereich
  async downloadTilesForBounds(
    urlTemplate: string,
    provider: string,
    points: Array<{ lat: number; lon: number }>,
    minZoom: number,
    maxZoom: number,
    progressCallback?: (progress: DownloadProgress) => void,
    abortSignal?: { aborted: boolean }
  ): Promise<BoundsDownloadResult> {
    console.log('[TileCache] downloadTilesForBounds gestartet')
    console.log('[TileCache] Punkte:', points)
    console.log('[TileCache] Zoom:', minZoom, '-', maxZoom)

    const tiles = this.getTilesForPolygon(points, minZoom, maxZoom)
    console.log('[TileCache] Anzahl Tiles:', tiles.length)
    const result: BoundsDownloadResult = {
      success: true,
      tilesDownloaded: 0,
      tilesCached: 0,
      tilesFailed: 0,
      totalSize: 0
    }

    const progress: DownloadProgress = {
      total: tiles.length,
      downloaded: 0,
      cached: 0,
      failed: 0,
      currentTile: ''
    }

    // Subdomains für Load Balancing
    const subdomains = ['a', 'b', 'c']
    let subdomainIndex = 0

    // Parallele Downloads - moderat um OSM Rate-Limits zu vermeiden
    const CONCURRENT_DOWNLOADS = 6
    const DELAY_BETWEEN_CHUNKS_MS = 200 // 200ms Pause zwischen Chunks

    // Teile Tiles in Chunks auf
    for (let i = 0; i < tiles.length; i += CONCURRENT_DOWNLOADS) {
      // Prüfe ob abgebrochen
      if (abortSignal?.aborted) {
        result.success = false
        break
      }

      const chunk = tiles.slice(i, i + CONCURRENT_DOWNLOADS)

      // Parallele Downloads
      const downloadPromises = chunk.map(async (tile) => {
        progress.currentTile = `z${tile.z}/x${tile.x}/y${tile.y}`

        // Prüfe ob Tile bereits im Cache
        const hasTile = await this.hasTile(provider, tile.z, tile.x, tile.y)
        if (hasTile) {
          progress.cached++
          result.tilesCached++
          return
        }

        // URL generieren
        const subdomain = subdomains[subdomainIndex++ % subdomains.length]
        const url = urlTemplate
          .replace('{s}', subdomain)
          .replace('{z}', tile.z.toString())
          .replace('{x}', tile.x.toString())
          .replace('{y}', tile.y.toString())

        // Tile herunterladen
        const downloaded = await this.fetchAndCacheTile(url, provider, tile.z, tile.x, tile.y)
        if (downloaded) {
          progress.downloaded++
          result.tilesDownloaded++
          result.totalSize += 15 * 1024
        } else {
          progress.failed++
          result.tilesFailed++
        }
      })

      await Promise.all(downloadPromises)
      progressCallback?.(progress)

      // Delay zwischen Chunks um OSM nicht zu überlasten
      if (i + CONCURRENT_DOWNLOADS < tiles.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS))
      }

      // Log alle 100 Tiles
      if ((progress.downloaded + progress.cached + progress.failed) % 100 === 0) {
        console.log(`[TileCache] Progress: ${progress.downloaded + progress.cached}/${progress.total}`)
      }
    }

    // Retry: Fehlgeschlagene Tiles nochmal versuchen (1 Retry-Runde)
    if (result.tilesFailed > 0 && !abortSignal?.aborted) {
      const failedTiles = tiles.filter(t => !this.hasTileSync(provider, t.z, t.x, t.y))
      if (failedTiles.length > 0) {
        console.log(`[TileCache] Retry: ${failedTiles.length} fehlgeschlagene Tiles nochmal versuchen...`)
        await new Promise(resolve => setTimeout(resolve, 2000)) // 2s Pause vor Retry

        for (let i = 0; i < failedTiles.length; i += CONCURRENT_DOWNLOADS) {
          if (abortSignal?.aborted) break
          const chunk = failedTiles.slice(i, i + CONCURRENT_DOWNLOADS)

          const retryPromises = chunk.map(async (tile) => {
            const subdomain = subdomains[subdomainIndex++ % subdomains.length]
            const url = urlTemplate
              .replace('{s}', subdomain)
              .replace('{z}', tile.z.toString())
              .replace('{x}', tile.x.toString())
              .replace('{y}', tile.y.toString())

            const downloaded = await this.fetchAndCacheTile(url, provider, tile.z, tile.x, tile.y)
            if (downloaded) {
              result.tilesFailed--
              result.tilesDownloaded++
            }
          })

          await Promise.all(retryPromises)
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS))
        }
        console.log(`[TileCache] Retry abgeschlossen. Noch ${result.tilesFailed} fehlende Tiles.`)
      }
    }

    console.log('[TileCache] Download abgeschlossen:', result)
    return result
  }

  // Synchrone Prüfung ob ein Tile existiert (für Retry-Logik)
  private hasTileSync(provider: string, z: number, x: number, y: number): boolean {
    const tilePath = path.join(this.cacheDir, this.sanitizeProvider(provider), z.toString(), x.toString(), `${y}.png`)
    return fs.existsSync(tilePath)
  }

  /**
   * Merge alle Tiles einer Zoom-Stufe zu einem großen Bild und reprojiziere nach UTM
   * Dies ermöglicht ein gerades UTM-Grid über der Karte
   */
  async mergeAndReprojectTiles(
    provider: string,
    points: Array<{ lat: number; lon: number }>,
    zoomLevel: number,
    utmZone: number,
    progressCallback?: (message: string, percent: number) => void
  ): Promise<{ imagePath: string; bounds: { north: number; south: number; east: number; west: number }; utmBounds: { minE: number; maxE: number; minN: number; maxN: number } } | null> {
    try {
      progressCallback?.('Berechne Tiles...', 0)

      // Berechne Bounding Box
      const lats = points.map(p => p.lat)
      const lons = points.map(p => p.lon)
      const minLat = Math.min(...lats)
      const maxLat = Math.max(...lats)
      const minLon = Math.min(...lons)
      const maxLon = Math.max(...lons)

      // Tile-Koordinaten für diese Zoom-Stufe
      const topLeft = this.latLonToTile(maxLat, minLon, zoomLevel)
      const bottomRight = this.latLonToTile(minLat, maxLon, zoomLevel)

      const tilesX = bottomRight.x - topLeft.x + 1
      const tilesY = bottomRight.y - topLeft.y + 1
      const tileSize = 256

      console.log(`[TileCache] Merge ${tilesX}x${tilesY} tiles at zoom ${zoomLevel}`)
      progressCallback?.(`Lade ${tilesX * tilesY} Tiles...`, 5)

      // Sammle alle Tiles
      const compositeOps: sharp.OverlayOptions[] = []
      let loadedTiles = 0
      const totalTiles = tilesX * tilesY

      for (let x = topLeft.x; x <= bottomRight.x; x++) {
        for (let y = topLeft.y; y <= bottomRight.y; y++) {
          const tilePath = this.getTilePath(provider, zoomLevel, x, y)

          if (fs.existsSync(tilePath)) {
            const offsetX = (x - topLeft.x) * tileSize
            const offsetY = (y - topLeft.y) * tileSize

            compositeOps.push({
              input: tilePath,
              left: offsetX,
              top: offsetY
            })
          }

          loadedTiles++
          if (loadedTiles % 50 === 0) {
            progressCallback?.(`Lade Tiles: ${loadedTiles}/${totalTiles}`, 5 + (loadedTiles / totalTiles) * 20)
          }
        }
      }

      if (compositeOps.length === 0) {
        console.error('[TileCache] Keine Tiles gefunden!')
        return null
      }

      progressCallback?.('Füge Tiles zusammen...', 30)

      // Erstelle großes Bild aus allen Tiles
      const imageWidth = tilesX * tileSize
      const imageHeight = tilesY * tileSize

      // Berechne Web Mercator Bounds für das zusammengefügte Bild
      const n = Math.pow(2, zoomLevel)
      const topLeftLon = (topLeft.x / n) * 360 - 180
      const topLeftLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * topLeft.y / n))) * 180 / Math.PI
      const bottomRightLon = ((bottomRight.x + 1) / n) * 360 - 180
      const bottomRightLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (bottomRight.y + 1) / n))) * 180 / Math.PI

      const imageBounds = {
        north: topLeftLat,
        south: bottomRightLat,
        west: topLeftLon,
        east: bottomRightLon
      }

      // Erstelle zusammengesetztes Bild
      const mergedImage = await sharp({
        create: {
          width: imageWidth,
          height: imageHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
        .composite(compositeOps)
        .png()
        .toBuffer()

      progressCallback?.('Reprojiziere nach UTM...', 50)

      // === UTM Reprojection ===
      // Berechne UTM-Bounds
      const utmBounds = this.calculateUtmBounds(imageBounds, utmZone)

      // Zielgröße für reprojiziertes Bild (gleiche Pixelauflösung beibehalten)
      const utmWidth = utmBounds.maxE - utmBounds.minE
      const utmHeight = utmBounds.maxN - utmBounds.minN
      const metersPerPixel = Math.max(utmWidth, utmHeight) / Math.max(imageWidth, imageHeight)

      const targetWidth = Math.min(8000, Math.round(utmWidth / metersPerPixel))
      const targetHeight = Math.min(8000, Math.round(utmHeight / metersPerPixel))

      console.log(`[TileCache] Reprojecting to ${targetWidth}x${targetHeight}px`)

      // Lade Quellbild
      const srcImage = sharp(mergedImage)
      const srcMeta = await srcImage.metadata()
      const srcRaw = await srcImage.raw().toBuffer()

      // Erstelle Zielbild
      const dstBuffer = Buffer.alloc(targetWidth * targetHeight * 4) // RGBA

      // Reprojiziere pixel-weise
      for (let dstY = 0; dstY < targetHeight; dstY++) {
        // Progress Update alle 100 Zeilen
        if (dstY % 100 === 0) {
          progressCallback?.(`Reprojiziere: ${Math.round(dstY / targetHeight * 100)}%`, 50 + (dstY / targetHeight) * 40)
        }

        for (let dstX = 0; dstX < targetWidth; dstX++) {
          // UTM-Koordinaten für diesen Zielpixel
          const easting = utmBounds.minE + (dstX / targetWidth) * utmWidth
          const northing = utmBounds.maxN - (dstY / targetHeight) * utmHeight

          // UTM -> WGS84
          const geo = this.utmToWgs84(easting, northing, utmZone, false)

          // WGS84 -> Quellpixel (Web Mercator)
          const srcXNorm = (geo.lon - imageBounds.west) / (imageBounds.east - imageBounds.west)
          const srcYNorm = (imageBounds.north - geo.lat) / (imageBounds.north - imageBounds.south)

          const srcX = Math.floor(srcXNorm * (srcMeta.width! - 1))
          const srcY = Math.floor(srcYNorm * (srcMeta.height! - 1))

          // Kopiere Pixel wenn innerhalb der Grenzen
          const dstIdx = (dstY * targetWidth + dstX) * 4

          if (srcX >= 0 && srcX < srcMeta.width! && srcY >= 0 && srcY < srcMeta.height!) {
            const srcIdx = (srcY * srcMeta.width! + srcX) * 3 // RGB
            dstBuffer[dstIdx] = srcRaw[srcIdx]         // R
            dstBuffer[dstIdx + 1] = srcRaw[srcIdx + 1] // G
            dstBuffer[dstIdx + 2] = srcRaw[srcIdx + 2] // B
            dstBuffer[dstIdx + 3] = 255                // A
          } else {
            // Transparent außerhalb
            dstBuffer[dstIdx + 3] = 0
          }
        }
      }

      progressCallback?.('Speichere Bild...', 95)

      // Speichere reprojiziertes Bild
      const reprojectedDir = path.join(app.getPath('userData'), 'reprojected-competition')
      if (!fs.existsSync(reprojectedDir)) {
        fs.mkdirSync(reprojectedDir, { recursive: true })
      }

      const imagePath = path.join(reprojectedDir, `competition_z${zoomLevel}_utm${utmZone}.jpg`)

      await sharp(dstBuffer, {
        raw: {
          width: targetWidth,
          height: targetHeight,
          channels: 4
        }
      })
        .jpeg({ quality: 90 })
        .toFile(imagePath)

      progressCallback?.('Fertig!', 100)

      console.log(`[TileCache] Reprojected image saved: ${imagePath}`)

      return {
        imagePath,
        bounds: imageBounds,
        utmBounds
      }
    } catch (error) {
      console.error('[TileCache] Merge/Reproject error:', error)
      return null
    }
  }

  /**
   * Berechne UTM-Bounds aus WGS84-Bounds
   */
  private calculateUtmBounds(bounds: { north: number; south: number; east: number; west: number }, zone: number): { minE: number; maxE: number; minN: number; maxN: number } {
    // Konvertiere alle 4 Ecken zu UTM
    const nw = this.wgs84ToUtm(bounds.north, bounds.west, zone)
    const ne = this.wgs84ToUtm(bounds.north, bounds.east, zone)
    const sw = this.wgs84ToUtm(bounds.south, bounds.west, zone)
    const se = this.wgs84ToUtm(bounds.south, bounds.east, zone)

    return {
      minE: Math.min(nw.easting, sw.easting),
      maxE: Math.max(ne.easting, se.easting),
      minN: Math.min(sw.northing, se.northing),
      maxN: Math.max(nw.northing, ne.northing)
    }
  }

  /**
   * WGS84 -> UTM Konvertierung
   */
  private wgs84ToUtm(lat: number, lon: number, zone: number): { easting: number; northing: number } {
    const a = 6378137.0
    const f = 1 / 298.257223563
    const k0 = 0.9996
    const e2 = 2 * f - f * f

    const latRad = lat * Math.PI / 180
    const lon0 = (zone - 1) * 6 - 180 + 3
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
   * UTM -> WGS84 Konvertierung
   */
  private utmToWgs84(easting: number, northing: number, zone: number, southern: boolean = false): { lat: number; lon: number } {
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

  // ==========================================
  // MBTiles Import
  // ==========================================

  /**
   * Importiert Tiles aus einer MBTiles-Datei (SQLite) in den Filesystem-Cache.
   * MBTiles verwendet TMS Y-Koordinaten (invertiert): osmY = (2^zoom - 1) - tmsY
   */
  async importMBTiles(
    mbtilesPath: string,
    provider: string,
    progressCallback?: (progress: MBTilesImportProgress) => void,
    abortSignal?: { aborted: boolean }
  ): Promise<MBTilesImportResult> {
    const result: MBTilesImportResult = {
      success: false,
      tilesImported: 0,
      tilesSkipped: 0,
      tilesFailed: 0,
      totalSize: 0,
      bounds: null,
      minZoom: 99,
      maxZoom: 0,
      name: ''
    }

    try {
      // Phase 1: sql.js initialisieren und Datei öffnen
      progressCallback?.({
        total: 0, imported: 0, skipped: 0, failed: 0,
        currentTile: 'Lade MBTiles Datei...',
        phase: 'reading'
      })

      console.log(`[TileCache] MBTiles Import: ${mbtilesPath}`)

      const SQL = await initSqlJs({
        locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm')
      })

      const fileBuffer = fs.readFileSync(mbtilesPath)
      console.log(`[TileCache] MBTiles Dateigröße: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`)
      const db = new SQL.Database(new Uint8Array(fileBuffer))

      // Metadata lesen
      try {
        const metaRows = db.exec('SELECT name, value FROM metadata')
        if (metaRows.length > 0) {
          for (const row of metaRows[0].values) {
            const key = row[0] as string
            const value = row[1] as string
            if (key === 'name') result.name = value
            if (key === 'bounds') {
              // MBTiles bounds Format: "west,south,east,north"
              const parts = value.split(',').map(Number)
              if (parts.length === 4 && parts.every(p => !isNaN(p))) {
                result.bounds = {
                  west: parts[0],
                  south: parts[1],
                  east: parts[2],
                  north: parts[3]
                }
              }
            }
            if (key === 'minzoom') result.minZoom = parseInt(value)
            if (key === 'maxzoom') result.maxZoom = parseInt(value)
          }
        }
        console.log(`[TileCache] MBTiles Metadata: name="${result.name}", bounds=${JSON.stringify(result.bounds)}, zoom=${result.minZoom}-${result.maxZoom}`)
      } catch (e) {
        console.warn('[TileCache] MBTiles Metadata nicht lesbar:', e)
      }

      // Tiles zählen
      const countResult = db.exec('SELECT COUNT(*) FROM tiles')
      const totalTiles = (countResult[0]?.values[0]?.[0] as number) || 0
      console.log(`[TileCache] MBTiles enthält ${totalTiles} Tiles`)

      const progress: MBTilesImportProgress = {
        total: totalTiles,
        imported: 0,
        skipped: 0,
        failed: 0,
        currentTile: '',
        phase: 'importing'
      }
      progressCallback?.(progress)

      // Phase 2: Tiles extrahieren und in Cache speichern
      const stmt = db.prepare('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles')

      let processedCount = 0
      while (stmt.step()) {
        if (abortSignal?.aborted) {
          console.log('[TileCache] MBTiles Import abgebrochen')
          stmt.free()
          db.close()
          return result
        }

        const row = stmt.get()
        const z = row[0] as number
        const tileColumn = row[1] as number  // x
        const tileRow = row[2] as number     // TMS y (invertiert)
        const tileData = row[3] as Uint8Array

        // TMS Y → OSM/Slippy Y konvertieren
        const osmY = (Math.pow(2, z) - 1) - tileRow

        // Zoom-Range tracken (falls Metadata unvollständig)
        if (z < result.minZoom) result.minZoom = z
        if (z > result.maxZoom) result.maxZoom = z

        progress.currentTile = `z${z}/x${tileColumn}/y${osmY}`

        // Prüfen ob Tile bereits im Cache
        const exists = await this.hasTile(provider, z, tileColumn, osmY)
        if (exists) {
          result.tilesSkipped++
          progress.skipped++
        } else {
          try {
            const buffer = Buffer.from(tileData)
            const saved = await this.saveTile(provider, z, tileColumn, osmY, buffer)
            if (saved) {
              result.tilesImported++
              result.totalSize += buffer.length
              progress.imported++
            } else {
              result.tilesFailed++
              progress.failed++
            }
          } catch (_e) {
            result.tilesFailed++
            progress.failed++
          }
        }

        processedCount++
        // Progress alle 50 Tiles senden
        if (processedCount % 50 === 0) {
          progressCallback?.(progress)
        }
      }

      stmt.free()
      db.close()

      // Finaler Progress
      progress.phase = 'done'
      progressCallback?.(progress)

      result.success = true
      console.log(`[TileCache] MBTiles Import abgeschlossen: ${result.tilesImported} neu, ${result.tilesSkipped} übersprungen, ${result.tilesFailed} Fehler`)
      return result

    } catch (error) {
      console.error('[TileCache] MBTiles Import Fehler:', error)
      result.success = false
      return result
    }
  }
}

// Singleton-Instanz
let tileCacheManager: TileCacheManager | null = null

export function getTileCacheManager(): TileCacheManager {
  if (!tileCacheManager) {
    tileCacheManager = new TileCacheManager()
  }
  return tileCacheManager
}
