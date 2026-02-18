import * as path from 'path'
import * as fs from 'fs'
import AdmZip from 'adm-zip'

// HGT 3 arc-second: 1201x1201 Punkte pro Kachel
const HGT_SIZE = 1201
const HGT_BYTES = HGT_SIZE * HGT_SIZE * 2 // 2.884.802 Bytes
const MAX_CACHE_TILES = 20 // Max Kacheln im RAM (~58MB)

export class ElevationManager {
  public hgtDir: string
  private cache: Map<string, Buffer> = new Map()
  private cacheOrder: string[] = [] // LRU-Reihenfolge
  private availableTiles: Set<string> = new Set()

  constructor(userDataPath: string) {
    this.hgtDir = path.join(userDataPath, 'hgt')

    // Verzeichnis erstellen falls nicht vorhanden
    if (!fs.existsSync(this.hgtDir)) {
      fs.mkdirSync(this.hgtDir, { recursive: true })
    }

    // Vorhandene HGT-Dateien scannen
    this.scanTiles()
  }

  // Vorhandene .hgt Dateien im Verzeichnis finden
  private scanTiles(): void {
    this.availableTiles.clear()
    try {
      const files = fs.readdirSync(this.hgtDir)
      for (const file of files) {
        if (file.toLowerCase().endsWith('.hgt')) {
          const name = file.replace(/\.hgt$/i, '').toUpperCase()
          // Validiere Dateiname (z.B. N47E011)
          if (/^[NS]\d{2}[EW]\d{3}$/.test(name)) {
            this.availableTiles.add(name)
          }
        }
      }
      console.log(`[Elevation] ${this.availableTiles.size} HGT-Kacheln gefunden`)
    } catch {
      console.error('[Elevation] Fehler beim Scannen des HGT-Verzeichnisses')
    }
  }

  // HGT-Dateiname fuer eine Koordinate berechnen
  // Die Kachel ist nach der SUEDWEST-Ecke benannt
  private getTileKey(lat: number, lon: number): string {
    const latFloor = Math.floor(lat)
    const lonFloor = Math.floor(lon)
    const ns = latFloor >= 0 ? 'N' : 'S'
    const ew = lonFloor >= 0 ? 'E' : 'W'
    const latStr = Math.abs(latFloor).toString().padStart(2, '0')
    const lonStr = Math.abs(lonFloor).toString().padStart(3, '0')
    return `${ns}${latStr}${ew}${lonStr}`
  }

  // Kachel in den RAM laden (mit LRU-Eviction)
  private loadTile(tileKey: string): Buffer | null {
    // Bereits im Cache?
    if (this.cache.has(tileKey)) {
      // LRU: an Ende verschieben
      this.cacheOrder = this.cacheOrder.filter(k => k !== tileKey)
      this.cacheOrder.push(tileKey)
      return this.cache.get(tileKey)!
    }

    // Datei auf Festplatte?
    if (!this.availableTiles.has(tileKey)) {
      return null
    }

    const filePath = path.join(this.hgtDir, `${tileKey}.hgt`)
    try {
      const buffer = fs.readFileSync(filePath)

      // Dateigroesse validieren
      if (buffer.length !== HGT_BYTES) {
        console.warn(`[Elevation] ${tileKey}.hgt hat falsche Groesse: ${buffer.length} (erwartet ${HGT_BYTES})`)
        return null
      }

      // LRU-Eviction wenn Cache voll
      while (this.cache.size >= MAX_CACHE_TILES && this.cacheOrder.length > 0) {
        const oldest = this.cacheOrder.shift()!
        this.cache.delete(oldest)
      }

      this.cache.set(tileKey, buffer)
      this.cacheOrder.push(tileKey)
      return buffer
    } catch (err) {
      console.error(`[Elevation] Fehler beim Laden von ${tileKey}.hgt:`, err)
      return null
    }
  }

  // Einzelne Hoehe abfragen mit bilinearer Interpolation
  getElevation(lat: number, lon: number): number | null {
    const tileKey = this.getTileKey(lat, lon)
    const buffer = this.loadTile(tileKey)
    if (!buffer) return null

    const latFloor = Math.floor(lat)
    const lonFloor = Math.floor(lon)

    // Fraktionale Position innerhalb der Kachel (0..1200)
    const latFrac = (lat - latFloor) * (HGT_SIZE - 1)
    const lonFrac = (lon - lonFloor) * (HGT_SIZE - 1)

    // Gitterpunkt-Indizes
    const row0 = Math.floor((HGT_SIZE - 1) - latFrac)
    const col0 = Math.floor(lonFrac)
    const row1 = Math.min(row0 + 1, HGT_SIZE - 1)
    const col1 = Math.min(col0 + 1, HGT_SIZE - 1)

    // Interpolationsgewichte
    const dLat = latFrac - Math.floor(latFrac)
    const dLon = lonFrac - Math.floor(lonFrac)

    // 4 umliegende Hoehenwerte lesen
    const h00 = this.readHeight(buffer, row0, col0)
    const h01 = this.readHeight(buffer, row0, col1)
    const h10 = this.readHeight(buffer, row1, col0)
    const h11 = this.readHeight(buffer, row1, col1)

    // Void-Werte pruefen (-32768 = no data)
    if (h00 === -32768 || h01 === -32768 || h10 === -32768 || h11 === -32768) {
      // Fallback: naechsten gueltigen Punkt verwenden
      const valid = [h00, h01, h10, h11].filter(h => h !== -32768)
      return valid.length > 0 ? valid[0] : null
    }

    // Bilineare Interpolation
    const h0 = h00 + (h01 - h00) * dLon
    const h1 = h10 + (h11 - h10) * dLon
    const height = h0 + (h1 - h0) * dLat

    return Math.round(height)
  }

  // Int16 Big-Endian aus Buffer lesen
  private readHeight(buffer: Buffer, row: number, col: number): number {
    const offset = (row * HGT_SIZE + col) * 2
    if (offset + 1 >= buffer.length) return -32768
    return buffer.readInt16BE(offset)
  }

  // Batch-Abfrage fuer mehrere Punkte
  getElevations(coords: { lat: number; lon: number }[]): (number | null)[] {
    return coords.map(c => this.getElevation(c.lat, c.lon))
  }

  // ZIP importieren: HGT-Dateien extrahieren
  async importFromZip(zipPath: string): Promise<{ imported: string[]; errors: string[] }> {
    const imported: string[] = []
    const errors: string[] = []

    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()

      for (const entry of entries) {
        const name = path.basename(entry.entryName)

        // Nur .hgt Dateien
        if (!name.toLowerCase().endsWith('.hgt')) continue

        const tileName = name.replace(/\.hgt$/i, '').toUpperCase()

        // Dateiname validieren
        if (!/^[NS]\d{2}[EW]\d{3}$/.test(tileName)) {
          errors.push(`${name}: Ungueltiger Dateiname`)
          continue
        }

        try {
          const data = entry.getData()

          // Groesse validieren
          if (data.length !== HGT_BYTES) {
            errors.push(`${name}: Falsche Groesse (${data.length} bytes)`)
            continue
          }

          // Nach hgtDir schreiben
          const destPath = path.join(this.hgtDir, `${tileName}.hgt`)
          fs.writeFileSync(destPath, data)
          this.availableTiles.add(tileName)
          imported.push(tileName)

          // Falls bereits im Cache: Cache invalidieren
          if (this.cache.has(tileName)) {
            this.cache.delete(tileName)
            this.cacheOrder = this.cacheOrder.filter(k => k !== tileName)
          }
        } catch (err: any) {
          errors.push(`${name}: ${err.message}`)
        }
      }

      console.log(`[Elevation] Import: ${imported.length} Kacheln importiert, ${errors.length} Fehler`)
    } catch (err: any) {
      errors.push(`ZIP-Fehler: ${err.message}`)
    }

    return { imported, errors }
  }

  // Alle verfuegbaren Kacheln (auf Festplatte)
  getLoadedTiles(): string[] {
    return Array.from(this.availableTiles).sort()
  }

  // Pruefen ob Kachel fuer Koordinate vorhanden
  hasTile(lat: number, lon: number): boolean {
    return this.availableTiles.has(this.getTileKey(lat, lon))
  }
}
