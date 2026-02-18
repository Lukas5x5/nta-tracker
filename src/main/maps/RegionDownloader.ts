import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

interface DownloadProgress {
  total: number
  downloaded: number
  cached: number
  failed: number
  currentTile: string
  bytesDownloaded: number
}

interface Tile {
  z: number
  x: number
  y: number
}

/**
 * RegionDownloader - Lädt komplette Regionen als Tile-Ordner herunter
 *
 * Die Tiles werden in einer Ordnerstruktur gespeichert:
 * /region-name/z/x/y.png
 *
 * Diese Struktur kann direkt auf einen Tile-Server hochgeladen werden.
 */
export class RegionDownloader {
  private outputDir: string

  constructor() {
    // Speichere im Dokumente-Ordner
    this.outputDir = path.join(app.getPath('documents'), 'NTA-Tiles')
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
  }

  /**
   * Berechnet alle Tiles für eine Region
   */
  private getTilesForBounds(bounds: Bounds, minZoom: number, maxZoom: number): Tile[] {
    const tiles: Tile[] = []

    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z)

      // Konvertiere Lat/Lon zu Tile-Koordinaten
      const xMin = Math.floor((bounds.west + 180) / 360 * n)
      const xMax = Math.floor((bounds.east + 180) / 360 * n)

      const yMin = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
      const yMax = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          tiles.push({ z, x, y })
        }
      }
    }

    return tiles
  }

  /**
   * Lädt ein einzelnes Tile herunter
   */
  private async downloadTile(z: number, x: number, y: number, subdomain: string): Promise<Buffer | null> {
    const url = `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'NTA-BalloonNavigator/1.0 (https://watchmefly.net; contact@watchmefly.net)'
        }
      })

      if (!response.ok) {
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch {
      return null
    }
  }

  /**
   * Lädt eine komplette Region herunter
   */
  async downloadRegion(
    name: string,
    bounds: Bounds,
    minZoom: number,
    maxZoom: number,
    progressCallback?: (progress: DownloadProgress) => void,
    abortSignal?: { aborted: boolean }
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> {

    console.log(`[RegionDownloader] Starte Download für ${name}`)
    console.log(`[RegionDownloader] Bounds: N${bounds.north} S${bounds.south} E${bounds.east} W${bounds.west}`)
    console.log(`[RegionDownloader] Zoom: ${minZoom}-${maxZoom}`)

    // Berechne alle Tiles
    const tiles = this.getTilesForBounds(bounds, minZoom, maxZoom)
    console.log(`[RegionDownloader] Anzahl Tiles: ${tiles.length}`)

    // Erstelle Ausgabe-Ordner
    const folderName = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-z${minZoom}-${maxZoom}`
    const regionDir = path.join(this.outputDir, folderName)

    // Lösche alten Ordner falls vorhanden
    if (fs.existsSync(regionDir)) {
      fs.rmSync(regionDir, { recursive: true, force: true })
    }
    fs.mkdirSync(regionDir, { recursive: true })

    // Metadaten-Datei erstellen
    const metadata = {
      name,
      bounds,
      minZoom,
      maxZoom,
      tileCount: tiles.length,
      downloadedAt: new Date().toISOString(),
      provider: 'openstreetmap'
    }
    fs.writeFileSync(
      path.join(regionDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    const progress: DownloadProgress = {
      total: tiles.length,
      downloaded: 0,
      cached: 0,
      failed: 0,
      currentTile: '',
      bytesDownloaded: 0
    }

    // Subdomains für Load-Balancing
    const subdomains = ['a', 'b', 'c']
    let subdomainIndex = 0

    // Rate Limiting: Max 2 Requests pro Sekunde (OSM Policy)
    const DELAY_MS = 500 // 500ms zwischen Requests = 2 pro Sekunde

    // Download mit Rate-Limiting
    for (let i = 0; i < tiles.length; i++) {
      // Prüfe Abbruch
      if (abortSignal?.aborted) {
        return { success: false, error: 'Download abgebrochen' }
      }

      const tile = tiles[i]
      progress.currentTile = `z${tile.z}/x${tile.x}/y${tile.y}`

      // Erstelle Verzeichnisstruktur
      const tileDir = path.join(regionDir, tile.z.toString(), tile.x.toString())
      if (!fs.existsSync(tileDir)) {
        fs.mkdirSync(tileDir, { recursive: true })
      }

      const tilePath = path.join(tileDir, `${tile.y}.png`)

      // Prüfe ob Tile bereits existiert
      if (fs.existsSync(tilePath)) {
        progress.cached++
        continue
      }

      // Download
      const subdomain = subdomains[subdomainIndex++ % subdomains.length]
      const data = await this.downloadTile(tile.z, tile.x, tile.y, subdomain)

      if (data) {
        // Speichere Tile
        fs.writeFileSync(tilePath, data)
        progress.downloaded++
        progress.bytesDownloaded += data.length
      } else {
        progress.failed++
      }

      // Fortschritt melden
      if (i % 10 === 0 || i === tiles.length - 1) {
        progressCallback?.(progress)
      }

      // Rate Limiting
      if (i < tiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS))
      }

      // Log alle 100 Tiles
      if ((i + 1) % 100 === 0) {
        console.log(`[RegionDownloader] Progress: ${i + 1}/${tiles.length} (${progress.failed} failed)`)
      }
    }

    console.log(`[RegionDownloader] Download abgeschlossen: ${progress.downloaded} heruntergeladen, ${progress.failed} fehlgeschlagen`)

    return {
      success: true,
      outputPath: regionDir
    }
  }

  /**
   * Gibt den Ausgabe-Ordner zurück
   */
  getOutputDir(): string {
    return this.outputDir
  }

  /**
   * Listet alle heruntergeladenen Regionen auf
   */
  listDownloadedRegions(): Array<{ name: string; path: string; size: number; created: Date }> {
    if (!fs.existsSync(this.outputDir)) {
      return []
    }

    const folders = fs.readdirSync(this.outputDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const folderPath = path.join(this.outputDir, dirent.name)
        const metadataPath = path.join(folderPath, 'metadata.json')

        let size = 0
        let created = new Date()

        // Versuche Metadaten zu laden
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
            created = new Date(metadata.downloadedAt)
          } catch (e) {
            // Ignorieren
          }
        }

        // Berechne Ordnergröße (vereinfacht)
        const stats = fs.statSync(folderPath)
        size = stats.size

        return {
          name: dirent.name,
          path: folderPath,
          size,
          created
        }
      })

    return folders
  }
}

// Singleton-Instanz
let regionDownloader: RegionDownloader | null = null

export function getRegionDownloader(): RegionDownloader {
  if (!regionDownloader) {
    regionDownloader = new RegionDownloader()
  }
  return regionDownloader
}
