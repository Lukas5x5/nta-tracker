import { useEffect, useMemo, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

interface CachedTileLayerProps {
  url: string
  attribution?: string
  maxZoom?: number
  maxNativeZoom?: number
  subdomains?: string[]
  provider: string
  bounds?: { north: number; south: number; east: number; west: number } | null
  // Heruntergeladene Zoom-Stufen der Competition Map (z.B. { min: 8, max: 16 })
  downloadedZoomRange?: { min: number; max: number } | null
}

const getTilesAPI = () => {
  if (typeof window !== 'undefined' && window.ntaAPI?.tiles) {
    return window.ntaAPI.tiles
  }
  return null
}

const DEFAULT_SUBDOMAINS = ['a', 'b', 'c']

// Transparentes 1x1 PNG als Data-URL für Tiles außerhalb der Bounds
const EMPTY_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

// Hellgraues 256x256 Placeholder-Tile für fehlende Tiles (statt schwarz)
let _missingTileUrl: string | null = null
function getMissingTileUrl(): string {
  if (_missingTileUrl) return _missingTileUrl
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  // Dezenter hellgrauer Hintergrund passend zur Karte
  ctx.fillStyle = '#d4d4d4'
  ctx.fillRect(0, 0, 256, 256)
  // Subtiles Grid-Muster
  ctx.strokeStyle = '#c0c0c0'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke()
  }
  _missingTileUrl = canvas.toDataURL('image/png')
  return _missingTileUrl
}

// Berechnet alle Tile-Koordinaten für eine Zoom-Stufe innerhalb der Bounds
function getTilesForZoom(
  zoom: number,
  bounds: { north: number; south: number; east: number; west: number }
): Array<{ x: number; y: number; z: number }> {
  const tiles: Array<{ x: number; y: number; z: number }> = []
  const n = Math.pow(2, zoom)

  const xMin = Math.floor((bounds.west + 180) / 360 * n)
  const xMax = Math.floor((bounds.east + 180) / 360 * n)
  const yMin = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n)
  const yMax = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n)

  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ x, y, z: zoom })
    }
  }

  return tiles
}

// Berechnet die Geo-Bounds eines Tiles (z/x/y → north/south/east/west)
function tileToBounds(z: number, x: number, y: number): { north: number; south: number; east: number; west: number } {
  const n = Math.pow(2, z)
  const west = x / n * 360 - 180
  const east = (x + 1) / n * 360 - 180
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI
  return { north, south, east, west }
}

// Prüft ob ein Tile die Competition Bounds überlappt
function tileOverlapsBounds(
  z: number, x: number, y: number,
  compBounds: { north: number; south: number; east: number; west: number }
): boolean {
  const tile = tileToBounds(z, x, y)
  // Kein Overlap wenn komplett außerhalb
  if (tile.east <= compBounds.west || tile.west >= compBounds.east) return false
  if (tile.south >= compBounds.north || tile.north <= compBounds.south) return false
  return true
}

// Globaler Cache für vorgeladene Tile-Bilder (bleibt über Re-Renders erhalten)
// Speichert entweder data:URLs oder blob:URLs (Object URLs sind schneller)
const preloadedTileCache = new Map<string, string>()

// Pending-Promises für Tiles die gerade geladen werden (verhindert doppelte IPC-Calls)
const pendingTileLoads = new Map<string, Promise<string | null>>()

// Flag ob Preload abgeschlossen ist (pro Provider)
const preloadComplete = new Map<string, boolean>()

// Konvertiert eine Base64 Data-URL in eine Object URL (viel schneller für <img src>)
function dataUrlToObjectUrl(dataUrl: string): string {
  try {
    const [header, base64] = dataUrl.split(',')
    if (!base64) return dataUrl
    const mimeMatch = header.match(/data:([^;]+)/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/png'
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: mime })
    return URL.createObjectURL(blob)
  } catch {
    return dataUrl // Fallback
  }
}

export function CachedTileLayer({
  url,
  attribution,
  maxZoom = 20,
  maxNativeZoom = 19,
  subdomains,
  provider,
  bounds,
  downloadedZoomRange
}: CachedTileLayerProps) {
  const map = useMap()
  const layerRef = useRef<L.TileLayer | null>(null)
  // Stabile Referenz für subdomains
  const stableSubdomains = useMemo(() => subdomains || DEFAULT_SUBDOMAINS, [subdomains?.join(',')])
  // Stabile Referenz für bounds und zoom range
  const boundsRef = useRef(bounds)
  const zoomRangeRef = useRef(downloadedZoomRange)
  boundsRef.current = bounds
  zoomRangeRef.current = downloadedZoomRange
  // Tracking ob Preload bereits läuft
  const preloadStartedRef = useRef(false)

  // Preload alle gecachten Tiles wenn Competition Map aktiv wird (Batch-Loading)
  useEffect(() => {
    if (!bounds || !downloadedZoomRange || preloadStartedRef.current) return

    const tilesAPI = getTilesAPI()
    if (!tilesAPI) return

    preloadStartedRef.current = true
    preloadComplete.set(provider, false)
    console.log('[CachedTileLayer] Starte Batch-Preload für Competition Map...')

    const preloadTiles = async () => {
      const { min: minZoom, max: maxZoom } = downloadedZoomRange
      let loadedCount = 0
      let totalCount = 0
      const BATCH_SIZE = 50 // 50 Tiles pro IPC-Call

      // Aktuelle Zoom-Stufe des Users als Startpunkt
      const currentZoom = Math.round(map.getZoom())

      // Sammle alle Tile-Koordinaten, sortiert nach Priorität:
      // 1. Aktuelle Zoom-Stufe zuerst
      // 2. Dann abwechselnd nähere Stufen (current±1, current±2, ...)
      const zoomOrder: number[] = []
      const clampedCurrent = Math.max(minZoom, Math.min(maxZoom, currentZoom))
      zoomOrder.push(clampedCurrent)
      for (let offset = 1; offset <= (maxZoom - minZoom); offset++) {
        if (clampedCurrent + offset <= maxZoom) zoomOrder.push(clampedCurrent + offset)
        if (clampedCurrent - offset >= minZoom) zoomOrder.push(clampedCurrent - offset)
      }

      const allCoords: Array<{ x: number; y: number; z: number }> = []
      for (const z of zoomOrder) {
        const tiles = getTilesForZoom(z, bounds)
        for (const tile of tiles) {
          const cacheKey = `${provider}/${tile.z}/${tile.x}/${tile.y}`
          if (!preloadedTileCache.has(cacheKey)) {
            allCoords.push(tile)
          } else {
            loadedCount++
          }
        }
        totalCount += tiles.length
      }

      // Zähle Tiles der aktuellen Zoom-Stufe für Zwischenredraw
      const currentZoomTileCount = getTilesForZoom(clampedCurrent, bounds).length

      console.log(`[CachedTileLayer] Preloading ${allCoords.length} neue Tiles von ${totalCount} gesamt (Zoom ${minZoom}-${maxZoom}, Start bei Zoom ${clampedCurrent})...`)

      let tilesProcessed = 0
      let currentZoomRedrawDone = false

      const processBatch = async (batch: Array<{ x: number; y: number; z: number }>) => {
        try {
          if (tilesAPI.getBatch) {
            const results = await tilesAPI.getBatch(provider, batch)
            for (const result of results) {
              if (result.dataUrl) {
                const cacheKey = `${provider}/${result.z}/${result.x}/${result.y}`
                preloadedTileCache.set(cacheKey, dataUrlToObjectUrl(result.dataUrl))
                loadedCount++
              }
            }
          } else {
            for (const coord of batch) {
              try {
                const dataUrl = await tilesAPI.get(provider, coord.z, coord.x, coord.y)
                if (dataUrl) {
                  const cacheKey = `${provider}/${coord.z}/${coord.x}/${coord.y}`
                  preloadedTileCache.set(cacheKey, dataUrlToObjectUrl(dataUrl))
                  loadedCount++
                }
              } catch (_e) {
                // Ignorieren
              }
            }
          }
        } catch (_e) {
          // Fallback: Einzeln laden
          for (const coord of batch) {
            try {
              const dataUrl = await tilesAPI.get(provider, coord.z, coord.x, coord.y)
              if (dataUrl) {
                const cacheKey = `${provider}/${coord.z}/${coord.x}/${coord.y}`
                preloadedTileCache.set(cacheKey, dataUrlToObjectUrl(dataUrl))
                loadedCount++
              }
            } catch (_e2) {
              // Ignorieren
            }
          }
        }

        tilesProcessed += batch.length

        // Redraw nach dem Laden der aktuellen Zoom-Stufe
        if (!currentZoomRedrawDone && tilesProcessed >= currentZoomTileCount) {
          currentZoomRedrawDone = true
          console.log(`[CachedTileLayer] Aktuelle Zoom-Stufe ${clampedCurrent} geladen, Redraw...`)
          if (layerRef.current) {
            layerRef.current.redraw()
          }
        }

        if (tilesProcessed % 200 < BATCH_SIZE || tilesProcessed >= allCoords.length) {
          console.log(`[CachedTileLayer] Preload: ${loadedCount}/${totalCount}`)
        }
      }

      // Batch-Loading: Lade BATCH_SIZE Tiles pro IPC-Call
      for (let i = 0; i < allCoords.length; i += BATCH_SIZE) {
        const batch = allCoords.slice(i, i + BATCH_SIZE)
        await processBatch(batch)
      }

      preloadComplete.set(provider, true)
      console.log(`[CachedTileLayer] Preload abgeschlossen: ${loadedCount} Tiles im Memory-Cache`)

      // Redraw um Tiles zu aktualisieren die während dem Preload als fehlend markiert wurden
      if (layerRef.current) {
        layerRef.current.redraw()
      }
    }

    preloadTiles()

    return () => {}
  }, [bounds, downloadedZoomRange, provider])

  // Reset preload flag wenn bounds sich ändern
  useEffect(() => {
    if (!bounds) {
      preloadStartedRef.current = false
      preloadComplete.delete(provider)
    }
  }, [bounds, provider])

  useEffect(() => {
    const tilesAPI = getTilesAPI()

    const CachedLayer = L.TileLayer.extend({
      createTile: function(coords: L.Coords, done: (error: Error | null, tile: HTMLImageElement) => void) {
        const tile = document.createElement('img')
        const currentBounds = boundsRef.current
        const currentZoomRange = zoomRangeRef.current

        const cacheKey = `${provider}/${coords.z}/${coords.x}/${coords.y}`
        const tileUrl = this.getTileUrl(coords)

        tile.alt = ''
        tile.crossOrigin = 'anonymous'
        tile.referrerPolicy = 'no-referrer'

        // Wenn Competition Map aktiv: Tile nur laden wenn es die Bounds überlappt
        if (currentBounds) {
          if (!tileOverlapsBounds(coords.z, coords.x, coords.y, currentBounds)) {
            // Tile liegt komplett außerhalb der Competition Bounds → transparentes Tile
            tile.onload = () => done(null, tile)
            tile.src = EMPTY_TILE
            return tile
          }
        }

        const isInDownloadedRange = currentZoomRange &&
          coords.z >= currentZoomRange.min &&
          coords.z <= currentZoomRange.max

        // Flag um doppelte done()-Aufrufe zu verhindern
        let doneCalled = false
        const safeDone = (err: Error | null, t: HTMLImageElement) => {
          if (doneCalled) return
          doneCalled = true
          // Pending-Promise entfernen
          pendingTileLoads.delete(cacheKey)
          // Wenn das Tile kein gültiges src hat, Placeholder setzen
          // (verhindert schwarze Tiles wenn kein Bild geladen wurde)
          if (!t.src || t.src === '' || t.src === 'about:blank') {
            t.src = getMissingTileUrl()
            t.onload = () => done(null, t)
            return
          }
          done(err, t)
        }

        // 1. Memory-Cache prüfen (sofort verfügbar)
        if (preloadedTileCache.has(cacheKey)) {
          tile.onload = () => safeDone(null, tile)
          tile.onerror = () => {
            preloadedTileCache.delete(cacheKey)
            this._loadFromNetwork(tile, tileUrl, coords, safeDone, tilesAPI, provider, isInDownloadedRange)
          }
          tile.src = preloadedTileCache.get(cacheKey)!
          return tile
        }

        // CSS-Hintergrund als Placeholder setzen damit das Tile nie leer/schwarz ist während async geladen wird
        // (CSS background statt img src, damit kein onload getriggert wird)
        tile.style.backgroundColor = '#d4d4d4'

        // 2. Wenn ein Pending-Load für diesen Tile läuft (z.B. durch Preload), darauf warten
        if (pendingTileLoads.has(cacheKey)) {
          const self = this
          pendingTileLoads.get(cacheKey)!.then((dataUrl) => {
            if (doneCalled) return
            if (dataUrl) {
              tile.onload = () => safeDone(null, tile)
              tile.onerror = () => {
                self._loadFromNetwork(tile, tileUrl, coords, safeDone, tilesAPI, provider, isInDownloadedRange)
              }
              tile.src = dataUrl
            } else {
              self._loadFromNetwork(tile, tileUrl, coords, safeDone, tilesAPI, provider, isInDownloadedRange)
            }
          })
          return tile
        }

        // 3. Dateisystem-Cache prüfen (mit Pending-Tracking)
        if (tilesAPI) {
          const self = this
          const loadPromise = tilesAPI.get(provider, coords.z, coords.x, coords.y)
          pendingTileLoads.set(cacheKey, loadPromise)

          loadPromise
            .then((dataUrl: string | null) => {
              if (doneCalled) return
              if (dataUrl) {
                // Konvertiere zu Object URL und cache im Memory
                const objUrl = dataUrlToObjectUrl(dataUrl)
                if (isInDownloadedRange) {
                  preloadedTileCache.set(cacheKey, objUrl)
                }
                tile.onload = () => safeDone(null, tile)
                tile.onerror = () => {
                  self._loadFromNetwork(tile, tileUrl, coords, safeDone, tilesAPI, provider, isInDownloadedRange)
                }
                tile.src = objUrl
              } else {
                pendingTileLoads.delete(cacheKey)
                // Tile nicht im Dateisystem-Cache
                if (isInDownloadedRange && !navigator.onLine) {
                  // Offline + sollte vorhanden sein → Placeholder sofort (kein sinnloser Network-Versuch)
                  safeDone(null, tile) // tile hat CSS background als Placeholder
                } else {
                  // Online oder nicht im Download-Range → Network versuchen
                  self._loadFromNetwork(tile, tileUrl, coords, safeDone, tilesAPI, provider, isInDownloadedRange)
                }
              }
            })
            .catch(() => {
              pendingTileLoads.delete(cacheKey)
              if (doneCalled) return
              if (isInDownloadedRange && !navigator.onLine) {
                safeDone(null, tile)
              } else {
                self._loadFromNetwork(tile, tileUrl, coords, safeDone, tilesAPI, provider, isInDownloadedRange)
              }
            })
        } else {
          this._loadFromNetwork(tile, tileUrl, coords, safeDone, null, provider, false)
        }

        return tile
      },

      _loadFromNetwork: function(
        tile: HTMLImageElement,
        tileUrl: string,
        coords: L.Coords,
        done: (error: Error | null, tile: HTMLImageElement) => void,
        tilesAPI: any,
        prov: string,
        saveToMemoryCache: boolean,
        retryCount?: number
      ) {
        // Offline → Placeholder anzeigen statt schwarzes Tile
        if (!navigator.onLine) {
          tile.onload = () => done(null, tile)
          tile.src = getMissingTileUrl()
          return
        }

        const cacheKey = `${prov}/${coords.z}/${coords.x}/${coords.y}`
        const attempt = retryCount || 0
        const MAX_RETRIES = 2

        tile.onload = () => {
          // Prüfe ob das geladene Tile tatsächlich Inhalt hat
          // Ein 1x1 oder sehr kleines Bild deutet auf ein leeres/Error-Tile hin
          if (tile.naturalWidth <= 1 || tile.naturalHeight <= 1) {
            tile.onload = () => done(null, tile)
            tile.onerror = null
            tile.src = getMissingTileUrl()
            return
          }

          done(null, tile)

          // Im Hintergrund in Cache speichern
          if (tilesAPI) {
            setTimeout(() => {
              try {
                const canvas = document.createElement('canvas')
                canvas.width = tile.naturalWidth || 256
                canvas.height = tile.naturalHeight || 256
                const ctx = canvas.getContext('2d')
                if (ctx) {
                  try {
                    ctx.drawImage(tile, 0, 0)
                    canvas.toDataURL() // Tainted-Test

                    if (saveToMemoryCache) {
                      preloadedTileCache.set(cacheKey, dataUrlToObjectUrl(canvas.toDataURL('image/png')))
                    }

                    canvas.toBlob((blob) => {
                      if (blob) {
                        blob.arrayBuffer().then((buffer) => {
                          const uint8 = new Uint8Array(buffer)
                          let binary = ''
                          for (let i = 0; i < uint8.length; i++) {
                            binary += String.fromCharCode(uint8[i])
                          }
                          tilesAPI.saveTile(prov, coords.z, coords.x, coords.y, btoa(binary))
                        })
                      }
                    }, 'image/png')
                  } catch (_e) {
                    // Canvas tainted — Cache überspringen
                  }
                }
              } catch (_e) {
                // Ignorieren
              }
            }, 100)
          }
        }

        tile.onerror = () => {
          if (attempt < MAX_RETRIES) {
            const delay = 1000 * (attempt + 1)
            setTimeout(() => {
              tile.onload = null
              tile.onerror = null
              this._loadFromNetwork(tile, tileUrl, coords, done, tilesAPI, prov, saveToMemoryCache, attempt + 1)
            }, delay)
          } else {
            // Statt Error (= schwarzes Tile): Platzhalter zeigen
            tile.onload = () => done(null, tile)
            tile.onerror = null
            tile.src = getMissingTileUrl()
          }
        }

        tile.src = tileUrl
      }
    })

    const hasActiveBounds = !!bounds

    const layer = new (CachedLayer as new (...args: any[]) => L.TileLayer)(url, {
      attribution,
      maxZoom,
      maxNativeZoom,
      subdomains: stableSubdomains,
      // Offline: Viele Tiles im DOM behalten damit Zoom schneller ist
      keepBuffer: hasActiveBounds ? 25 : 4,
      updateWhenIdle: false,
      updateWhenZooming: !hasActiveBounds, // Bei Competition Map: Zoom erst laden wenn idle
      errorTileUrl: EMPTY_TILE,
    })

    layer.addTo(map)
    layerRef.current = layer

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url, provider, bounds?.north, bounds?.south, bounds?.east, bounds?.west])

  return null
}
