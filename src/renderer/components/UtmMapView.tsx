import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useFlightStore } from '../stores/flightStore'

interface UtmMapViewProps {
  onClose: () => void
}

/**
 * UTM-Kartenansicht mit geradem Grid
 * Zeigt entweder:
 * 1. Ein reprojiziertes Bild (wenn vorhanden) in einem Pixel-Koordinatensystem (L.CRS.Simple)
 * 2. Oder lädt OSM-Tiles und zeigt sie mit geradem UTM-Grid
 */
export function UtmMapView({ onClose }: UtmMapViewProps) {
  const { activeCompetitionMap, gpsData } = useFlightStore()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [loadingImage, setLoadingImage] = useState(true)
  const [tilesLoaded, setTilesLoaded] = useState(false)

  const utmReprojection = activeCompetitionMap?.utmReprojection
  const bounds = activeCompetitionMap?.bounds

  // UTM Zone aus CompetitionMap oder berechnen
  const utmZone = activeCompetitionMap?.utmZone ||
    utmReprojection?.utmZone ||
    (bounds ? Math.floor(((bounds.west + bounds.east) / 2 + 180) / 6) + 1 : 32)

  // UTM Bounds - entweder von Reprojection oder aus WGS84 Bounds berechnen
  const utmBounds = utmReprojection?.utmBounds || (bounds ? calculateUtmBounds(bounds, utmZone) : null)

  const imagePath = utmReprojection?.imagePath

  // Lade das Bild als Data-URL (nur wenn Reprojection vorhanden)
  useEffect(() => {
    if (!imagePath) {
      setLoadingImage(false)
      return
    }

    setLoadingImage(true)
    window.ntaAPI?.tiles?.getReprojectedImage?.(imagePath)
      .then((dataUrl) => {
        setImageDataUrl(dataUrl)
        setLoadingImage(false)
      })
      .catch((err) => {
        console.error('Failed to load reprojected image:', err)
        setLoadingImage(false)
      })
  }, [imagePath])

  // Map initialisieren
  useEffect(() => {
    if (!mapContainerRef.current || !utmBounds) return
    if (imagePath && loadingImage) return // Warte auf Bild wenn vorhanden

    // Entferne alte Map falls vorhanden
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    // Bounds für L.CRS.Simple (Northing = Y, Easting = X)
    const mapBounds: L.LatLngBoundsExpression = [
      [utmBounds.minN, utmBounds.minE],  // SW corner
      [utmBounds.maxN, utmBounds.maxE]   // NE corner
    ]

    // Erstelle Map mit L.CRS.Simple (Pixel/UTM Koordinaten)
    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 5,
      zoomSnap: 0.25,
      attributionControl: false
    })

    mapRef.current = map

    // Wenn reprojiziertes Bild vorhanden, lade es
    if (imageDataUrl) {
      L.imageOverlay(imageDataUrl, mapBounds).addTo(map)
    } else if (bounds) {
      // Lade OSM-Tiles als Canvas-basiertes Bild
      loadOsmTilesAsImage(map, bounds, utmBounds, utmZone).then(() => {
        setTilesLoaded(true)
      })
    }

    // Setze View auf die Bounds
    map.fitBounds(mapBounds)

    // Zeichne UTM-Grid (gerade Linien!)
    drawUtmGrid(map, utmBounds)

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [imageDataUrl, utmBounds, loadingImage, bounds, utmZone])

  // GPS-Position auf UTM umrechnen und anzeigen
  useEffect(() => {
    if (!mapRef.current || !gpsData || !utmBounds) return

    // Konvertiere WGS84 zu UTM
    const utm = wgs84ToUtm(gpsData.latitude, gpsData.longitude, utmZone)

    // Prüfe ob Position innerhalb der Bounds liegt
    if (utm.easting >= utmBounds.minE && utm.easting <= utmBounds.maxE &&
        utm.northing >= utmBounds.minN && utm.northing <= utmBounds.maxN) {

      // Entferne alten Marker
      mapRef.current.eachLayer((layer) => {
        if ((layer as any)._balloonMarker) {
          mapRef.current?.removeLayer(layer)
        }
      })

      // Füge neuen Marker hinzu
      const marker = L.circleMarker([utm.northing, utm.easting], {
        radius: 8,
        fillColor: '#e74c3c',
        color: '#fff',
        weight: 2,
        fillOpacity: 1
      }).addTo(mapRef.current)
      ;(marker as any)._balloonMarker = true
    }
  }, [gpsData, utmZone, utmBounds])

  // Wenn keine Competition Map aktiv
  if (!activeCompetitionMap || !bounds) {
    return (
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1500,
        background: '#1a1a2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ color: '#ef4444', fontSize: 18 }}>Keine Wettkampfkarte aktiv</div>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
          Aktiviere zuerst eine Wettkampfkarte im Wettkampfbereich-Panel
        </div>
        <button onClick={onClose} style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Schließen
        </button>
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1500,
      background: '#1a1a2e'
    }}>
      {/* Header */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        background: 'linear-gradient(180deg, rgba(34,197,94,0.95) 0%, rgba(22,163,74,0.95) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 1600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
            📐 UTM-Ansicht (gerades Grid)
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
            Zone {utmZone} | {activeCompetitionMap?.name}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* UTM-Info */}
          {utmBounds && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace' }}>
              E: {utmBounds.minE.toFixed(0)} - {utmBounds.maxE.toFixed(0)} |
              N: {utmBounds.minN.toFixed(0)} - {utmBounds.maxN.toFixed(0)}
            </div>
          )}

          {/* Close Button */}
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ✕ Schließen
          </button>
        </div>
      </div>

      {/* Loading Indicator */}
      {(loadingImage || (!imageDataUrl && !tilesLoaded && bounds)) && (
        <div style={{
          position: 'absolute',
          top: 48,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a2e',
          zIndex: 1550
        }}>
          <div style={{ color: '#fff', fontSize: 16 }}>⏳ Lade UTM-Karte...</div>
        </div>
      )}

      {/* Map Container */}
      <div
        ref={mapContainerRef}
        style={{
          position: 'absolute',
          top: 48,
          left: 0,
          right: 0,
          bottom: 0
        }}
      />

      {/* Koordinaten-Anzeige */}
      {gpsData && utmBounds && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.8)',
          borderRadius: 6,
          color: '#fff',
          fontSize: 12,
          fontFamily: 'monospace',
          zIndex: 1600
        }}>
          <div>GPS: {gpsData.latitude.toFixed(6)}°, {gpsData.longitude.toFixed(6)}°</div>
          <div>UTM: {wgs84ToUtm(gpsData.latitude, gpsData.longitude, utmZone).easting.toFixed(0)} E, {wgs84ToUtm(gpsData.latitude, gpsData.longitude, utmZone).northing.toFixed(0)} N</div>
        </div>
      )}

      {/* Info-Badge */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        padding: '6px 10px',
        background: 'rgba(34,197,94,0.9)',
        borderRadius: 4,
        color: '#fff',
        fontSize: 11,
        zIndex: 1600
      }}>
        Grid ist gerade (UTM-Projektion)
      </div>
    </div>
  )
}

/**
 * Berechne UTM Bounds aus WGS84 Bounds
 */
function calculateUtmBounds(
  bounds: { north: number; south: number; east: number; west: number },
  zone: number
): { minE: number; maxE: number; minN: number; maxN: number } {
  // Konvertiere alle 4 Ecken
  const sw = wgs84ToUtm(bounds.south, bounds.west, zone)
  const se = wgs84ToUtm(bounds.south, bounds.east, zone)
  const nw = wgs84ToUtm(bounds.north, bounds.west, zone)
  const ne = wgs84ToUtm(bounds.north, bounds.east, zone)

  return {
    minE: Math.min(sw.easting, nw.easting),
    maxE: Math.max(se.easting, ne.easting),
    minN: Math.min(sw.northing, se.northing),
    maxN: Math.max(nw.northing, ne.northing)
  }
}

/**
 * Lade OSM-Tiles und zeichne sie als reprojiziertes Bild
 */
async function loadOsmTilesAsImage(
  map: L.Map,
  wgs84Bounds: { north: number; south: number; east: number; west: number },
  utmBounds: { minE: number; maxE: number; minN: number; maxN: number },
  zone: number
): Promise<void> {
  // Erstelle ein Canvas für das reprojizierte Bild
  const width = 2048
  const height = Math.round(width * (utmBounds.maxN - utmBounds.minN) / (utmBounds.maxE - utmBounds.minE))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Hintergrund
  ctx.fillStyle = '#e8e8e8'
  ctx.fillRect(0, 0, width, height)

  // Lade OSM-Tiles für den Bereich
  const zoom = 13 // Fester Zoom-Level für gute Auflösung

  // Berechne Tile-Koordinaten
  const minTileX = lonToTileX(wgs84Bounds.west, zoom)
  const maxTileX = lonToTileX(wgs84Bounds.east, zoom)
  const minTileY = latToTileY(wgs84Bounds.north, zoom)
  const maxTileY = latToTileY(wgs84Bounds.south, zoom)

  console.log(`[UtmMapView] Loading tiles: X ${minTileX}-${maxTileX}, Y ${minTileY}-${maxTileY}`)

  // Lade alle Tiles
  const tilePromises: Promise<void>[] = []

  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      const promise = loadAndDrawTile(ctx, x, y, zoom, wgs84Bounds, utmBounds, zone, width, height)
      tilePromises.push(promise)
    }
  }

  await Promise.all(tilePromises)

  // Konvertiere Canvas zu Data-URL und zeige als ImageOverlay
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9)

  const mapBounds: L.LatLngBoundsExpression = [
    [utmBounds.minN, utmBounds.minE],
    [utmBounds.maxN, utmBounds.maxE]
  ]

  L.imageOverlay(dataUrl, mapBounds).addTo(map)
}

/**
 * Lade ein Tile und zeichne es reprojiziert auf das Canvas
 */
async function loadAndDrawTile(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  zoom: number,
  wgs84Bounds: { north: number; south: number; east: number; west: number },
  utmBounds: { minE: number; maxE: number; minN: number; maxN: number },
  zone: number,
  canvasWidth: number,
  canvasHeight: number
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      // Berechne die WGS84 Bounds des Tiles
      const tileBounds = {
        west: tileXToLon(tileX, zoom),
        east: tileXToLon(tileX + 1, zoom),
        north: tileYToLat(tileY, zoom),
        south: tileYToLat(tileY + 1, zoom)
      }

      // Sample Punkte aus dem Tile und zeichne sie reprojiziert
      const tileSize = 256
      const sampleStep = 8 // Jeden 8. Pixel samplen für Performance

      for (let px = 0; px < tileSize; px += sampleStep) {
        for (let py = 0; py < tileSize; py += sampleStep) {
          // Pixel zu WGS84
          const lon = tileBounds.west + (px / tileSize) * (tileBounds.east - tileBounds.west)
          const lat = tileBounds.north + (py / tileSize) * (tileBounds.south - tileBounds.north)

          // Prüfe ob innerhalb der gewünschten Bounds
          if (lat < wgs84Bounds.south || lat > wgs84Bounds.north ||
              lon < wgs84Bounds.west || lon > wgs84Bounds.east) {
            continue
          }

          // WGS84 zu UTM
          const utm = wgs84ToUtm(lat, lon, zone)

          // UTM zu Canvas-Koordinaten
          const canvasX = ((utm.easting - utmBounds.minE) / (utmBounds.maxE - utmBounds.minE)) * canvasWidth
          const canvasY = canvasHeight - ((utm.northing - utmBounds.minN) / (utmBounds.maxN - utmBounds.minN)) * canvasHeight

          // Zeichne Pixel-Block
          ctx.drawImage(img, px, py, sampleStep, sampleStep, canvasX, canvasY, sampleStep * 2, sampleStep * 2)
        }
      }

      resolve()
    }

    img.onerror = () => {
      console.warn(`Failed to load tile ${zoom}/${tileX}/${tileY}`)
      resolve()
    }

    // OSM Tile URL
    const subdomains = ['a', 'b', 'c']
    const subdomain = subdomains[(tileX + tileY) % 3]
    img.src = `https://${subdomain}.tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`
  })
}

// Tile-Koordinaten Hilfsfunktionen
function lonToTileX(lon: number, zoom: number): number {
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom))
}

function latToTileY(lat: number, zoom: number): number {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))
}

function tileXToLon(x: number, zoom: number): number {
  return x / Math.pow(2, zoom) * 360 - 180
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom)
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/**
 * Zeichne gerades UTM-Grid
 */
function drawUtmGrid(map: L.Map, utmBounds: { minE: number; maxE: number; minN: number; maxN: number }) {
  const gridSpacing = 1000 // 1km Grid

  // Runde auf nächste Tausender
  const startE = Math.floor(utmBounds.minE / gridSpacing) * gridSpacing
  const startN = Math.floor(utmBounds.minN / gridSpacing) * gridSpacing
  const endE = Math.ceil(utmBounds.maxE / gridSpacing) * gridSpacing
  const endN = Math.ceil(utmBounds.maxN / gridSpacing) * gridSpacing

  const gridStyle: L.PolylineOptions = {
    color: 'rgba(0, 100, 255, 0.5)',
    weight: 1,
    dashArray: '5, 5'
  }

  const majorGridStyle: L.PolylineOptions = {
    color: 'rgba(0, 100, 255, 0.8)',
    weight: 2
  }

  // Vertikale Linien (Easting) - PERFEKT GERADE!
  for (let e = startE; e <= endE; e += gridSpacing) {
    const isMajor = e % 10000 === 0
    L.polyline([
      [utmBounds.minN, e],
      [utmBounds.maxN, e]
    ], isMajor ? majorGridStyle : gridStyle).addTo(map)

    // Label
    if (isMajor || e % 5000 === 0) {
      L.marker([utmBounds.minN, e], {
        icon: L.divIcon({
          className: 'utm-grid-label',
          html: `<div style="background: rgba(0,0,0,0.7); color: #fff; padding: 2px 4px; font-size: 10px; font-family: monospace; border-radius: 2px;">${(e / 1000).toFixed(0)}km E</div>`,
          iconSize: [50, 16],
          iconAnchor: [25, -5]
        })
      }).addTo(map)
    }
  }

  // Horizontale Linien (Northing) - PERFEKT GERADE!
  for (let n = startN; n <= endN; n += gridSpacing) {
    const isMajor = n % 10000 === 0
    L.polyline([
      [n, utmBounds.minE],
      [n, utmBounds.maxE]
    ], isMajor ? majorGridStyle : gridStyle).addTo(map)

    // Label
    if (isMajor || n % 5000 === 0) {
      L.marker([n, utmBounds.minE], {
        icon: L.divIcon({
          className: 'utm-grid-label',
          html: `<div style="background: rgba(0,0,0,0.7); color: #fff; padding: 2px 4px; font-size: 10px; font-family: monospace; border-radius: 2px;">${(n / 1000).toFixed(0)}km N</div>`,
          iconSize: [50, 16],
          iconAnchor: [-5, 8]
        })
      }).addTo(map)
    }
  }
}

/**
 * WGS84 -> UTM Konvertierung
 */
function wgs84ToUtm(lat: number, lon: number, zone: number): { easting: number; northing: number } {
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
