import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Circle, CircleMarker, Polyline, Polygon, Rectangle, useMap, useMapEvents, ImageOverlay, Pane } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet-imageoverlay-rotated'
import { useFlightStore } from '../stores/flightStore'
import { Task, Goal, WindLayer, ImportedTrajectory, TrajectoryPoint, Waypoint } from '../../shared/types'
import { formatCoordinate, latLonToUTM, utmToLatLon } from '../utils/coordinatesWGS84'
import { calculateBearing, calculateDestination } from '../utils/navigation'
// MapLayerPanel entfernt - Kartenverwaltung jetzt über Meisterschaften
import { FlightWindsPanel } from './FlightWindsPanel'
import { MarkerSettingsPanel } from './MarkerSettingsPanel'
import { TaskEditPanel } from './TaskEditPanel'
import { Stopwatch } from './Stopwatch'
import { MeasureTool, MeasureMode } from './MeasureTool'
import { PowerLinesLayer, PowerLinesLegend } from './PowerLinesLayer'
import { CachedTileLayer } from './CachedTileLayer'
import { CompetitionAreaPanel } from './CompetitionAreaPanel'
import { WindRose } from './WindRose'
import { UtmMapView } from './UtmMapView'
import { useTeamStore } from '../stores/teamStore'

// Mock für Browser-Modus (wenn nicht in Electron)
const getMapsAPI = () => {
  if (typeof window !== 'undefined' && window.ntaAPI?.maps) {
    return window.ntaAPI.maps
  }
  // Mock API für Browser-Entwicklung
  return {
    list: async () => [] as any[],
    import: async () => null,
    importWithImage: async () => null,
    remove: async () => false,
    selectFiles: async () => null,
    getImagePath: async () => '',
    getImageDataUrl: async () => '',
    getTileInfo: async (_mapId: string) => null as { tileUrl: string; imageUrl: string; bounds: any; maxZoom: number; minZoom: number; tileSize: number; imageWidth: number; imageHeight: number } | null,
    geoToPixel: async () => null,
    pixelToGeo: async () => null,
    geoToDisplayCoord: async () => null,
    findForLocation: async () => [] as any[],
    updateCalibration: async () => false,
    areTilesCached: async () => false,
    prepareTiles: async (_mapId: string, _onProgress: (progress: number, total: number) => void) => false
  }
}

// Typ für aktive Karten - VEREINFACHT
interface ActiveMapLayer {
  id: string
  name: string
  imagePath: string
  bounds: L.LatLngBoundsExpression
  opacity: number
}

// Funktion zum Erstellen des Ballon-Icons basierend auf Einstellungen mit Rotation
const createBalloonIcon = (size: 'small' | 'medium' | 'large', iconType: string, heading: number = 0, color: string = '#e74c3c') => {
  const sizes = {
    small: { width: 24, height: 24 },
    medium: { width: 32, height: 32 },
    large: { width: 48, height: 48 }
  }

  const { width, height } = sizes[size]

  // Verschiedene Pfeil-Stile - Spitze ist immer bei y=2 im viewBox (0 0 32 32)
  let arrowPath = ''
  switch (iconType) {
    case 'arrow':
      arrowPath = 'M16 2 L28 22 L22 22 L22 30 L10 30 L10 22 L4 22 Z'
      break
    case 'triangle':
      arrowPath = 'M16 2 L30 28 L2 28 Z'
      break
    case 'dart':
      arrowPath = 'M16 2 L26 16 L16 24 L6 16 Z M16 18 L16 30'
      break
    case 'pointer':
      arrowPath = 'M16 2 L28 30 L16 22 L4 30 Z'
      break
    case 'diamond':
      arrowPath = 'M16 2 L28 16 L16 30 L4 16 Z'
      break
    case 'chevron':
      arrowPath = 'M16 2 L28 14 L16 26 L4 14 Z M16 8 L22 14 L16 20 L10 14 Z'
      break
    case 'aircraft':
      arrowPath = 'M16 2 L18 10 L28 14 L28 18 L18 16 L18 26 L22 28 L22 30 L16 28 L10 30 L10 28 L14 26 L14 16 L4 18 L4 14 L14 10 Z'
      break
    case 'circle':
      arrowPath = 'M16 6 A10 10 0 1 1 16 26 A10 10 0 1 1 16 6 M16 2 L16 6 M16 26 L16 30'
      break
    default:
      arrowPath = 'M16 2 L28 22 L22 22 L22 30 L10 30 L10 22 L4 22 Z'
  }

  // Spitze ist bei y=2 im 32x32 viewBox, umgerechnet auf die tatsächliche Icon-Größe
  // Die Spitze soll immer auf der GPS-Position liegen
  const tipY = (2 / 32) * height  // Position der Spitze relativ zur Icon-Höhe

  // Pfeil zeigt nach oben (0° = Nord), rotation dreht ihn zum Bearing/Course
  // transform-origin muss auf die Spitze gesetzt werden, damit sich der Pfeil um die Spitze dreht
  let html = `
    <div style="
      width: ${width}px;
      height: ${height}px;
      transform: rotate(${heading}deg);
      transform-origin: 50% ${tipY}px;
    ">
      <svg width="${width}" height="${height}" viewBox="0 0 32 32" fill="none">
        <path d="${arrowPath}" fill="${color}" stroke="#fff" stroke-width="2"/>
      </svg>
    </div>
  `

  return L.divIcon({
    className: 'balloon-marker',
    html,
    iconSize: [width, height],
    // Anchor ist jetzt an der Spitze des Pfeils (horizontal Mitte, vertikal bei der Spitze)
    iconAnchor: [width / 2, tipY]
  })
}

// Smooth Balloon Marker — "Render In The Past" Algorithmus
// Gleiche Technik wie Google Maps, OziExplorer, Uber, Valve Source Engine.
// Der Marker rendert IMMER zwischen zwei BEREITS BEKANNTEN GPS-Positionen
// (einen Update-Zyklus in der Vergangenheit). Dadurch:
// - Keine Extrapolation → kein Zurückspringen
// - Keine Vorhersage → keine falschen Positionen
// - Nur ~200ms Latenz (unsichtbar, innerhalb GPS-Genauigkeit)
// - 60fps flüssige Bewegung zwischen den GPS-Punkten

interface GPSSnapshot {
  lat: number
  lon: number
  heading: number
  time: number  // performance.now() Zeitstempel
}

function SmoothBalloonMarker({ position, heading, size, iconType, color }: {
  position: [number, number]
  heading: number
  size: 'small' | 'medium' | 'large'
  iconType: string
  color: string
}) {
  const map = useMap()
  const markerRef = useRef<L.Marker | null>(null)
  const iconRef = useRef<L.DivIcon | null>(null)

  // Positions-Buffer: Ring-Buffer der letzten GPS-Snapshots
  const bufferRef = useRef<GPSSnapshot[]>([])
  const animFrameRef = useRef<number>(0)
  const styleRef = useRef({ size, iconType, color })
  // Dynamischer RENDER_DELAY: passt sich automatisch an die tatsächliche GPS-Rate an
  // Bei 5Hz (200ms) → Delay ~250ms, bei 1Hz (1000ms) → Delay ~1100ms
  const avgIntervalRef = useRef<number>(0)

  // Icon nur erstellen wenn sich Style-Parameter ändern
  useEffect(() => {
    const s = styleRef.current
    const needsNewIcon = !iconRef.current ||
      size !== s.size || iconType !== s.iconType || color !== s.color

    if (needsNewIcon) {
      iconRef.current = createBalloonIcon(size, iconType, 0, color)
      s.size = size
      s.iconType = iconType
      s.color = color
      if (markerRef.current) markerRef.current.setIcon(iconRef.current)
    }
  }, [size, iconType, color])

  // Animation Loop — läuft permanent bei 60fps
  const animateRef = useRef<() => void>()
  animateRef.current = () => {
    const marker = markerRef.current
    const buffer = bufferRef.current
    if (!marker || buffer.length < 2) {
      // Noch nicht genug Daten — Marker auf letzte bekannte Position
      if (marker && buffer.length === 1) {
        marker.setLatLng([buffer[0].lat, buffer[0].lon])
      }
      animFrameRef.current = requestAnimationFrame(animateRef.current!)
      return
    }

    // "Render in the Past": Wir rendern EINEN Update-Zyklus hinter der Realzeit
    // RENDER_DELAY = gemessener GPS-Intervall + 50ms Jitter-Toleranz
    // Bei 5Hz → ~250ms, bei 1Hz → ~1050ms — passt sich automatisch an
    const now = performance.now()
    const measuredInterval = avgIntervalRef.current
    const RENDER_DELAY = measuredInterval > 0 ? measuredInterval + 50 : 250
    const renderTime = now - RENDER_DELAY

    // Finde die zwei Buffer-Einträge die renderTime umschließen
    let before: GPSSnapshot | null = null
    let after: GPSSnapshot | null = null

    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].time <= renderTime && buffer[i + 1].time >= renderTime) {
        before = buffer[i]
        after = buffer[i + 1]
        break
      }
    }

    if (before && after) {
      // Perfekter Fall: Interpolation zwischen zwei bekannten Positionen
      const segmentDuration = after.time - before.time
      const elapsed = renderTime - before.time
      const t = segmentDuration > 0 ? Math.min(elapsed / segmentDuration, 1.0) : 1.0

      const lat = before.lat + (after.lat - before.lat) * t
      const lon = before.lon + (after.lon - before.lon) * t

      marker.setLatLng([lat, lon])

      // Heading: kürzester Weg interpolieren
      let hDiff = after.heading - before.heading
      if (hDiff > 180) hDiff -= 360
      if (hDiff < -180) hDiff += 360
      const displayHeading = before.heading + hDiff * t

      const el = marker.getElement()
      if (el) {
        const innerDiv = el.querySelector('div') as HTMLElement
        if (innerDiv) innerDiv.style.transform = `rotate(${displayHeading}deg)`
      }

      // Alte Einträge VOR "before" entfernen — sie werden nie mehr gebraucht
      // Behalte "before" als Sicherheits-Anker
      const beforeIdx = buffer.indexOf(before)
      if (beforeIdx > 0) {
        buffer.splice(0, beforeIdx)
      }
    } else if (buffer.length >= 2) {
      // renderTime liegt nach dem letzten Eintrag — zeige letzten Punkt
      // Das passiert nur wenn GPS-Updates ausbleiben (> 400ms Lücke)
      const last = buffer[buffer.length - 1]
      marker.setLatLng([last.lat, last.lon])
      const el = marker.getElement()
      if (el) {
        const innerDiv = el.querySelector('div') as HTMLElement
        if (innerDiv) innerDiv.style.transform = `rotate(${last.heading}deg)`
      }
    }

    animFrameRef.current = requestAnimationFrame(animateRef.current!)
  }

  // Marker einmalig erstellen + Animation starten
  useEffect(() => {
    if (!iconRef.current) {
      iconRef.current = createBalloonIcon(size, iconType, 0, color)
    }

    const marker = L.marker(position, {
      icon: iconRef.current,
      zIndexOffset: 1500,
      interactive: false
    })
    marker.addTo(map)
    markerRef.current = marker

    const el = marker.getElement()
    if (el) {
      const innerDiv = el.querySelector('div') as HTMLElement
      if (innerDiv) innerDiv.style.transform = `rotate(${heading}deg)`
    }

    // Animation Loop starten
    animFrameRef.current = requestAnimationFrame(animateRef.current!)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      marker.remove()
      markerRef.current = null
    }
  }, [map])

  // Neue GPS-Position empfangen → in den Buffer einfügen + Intervall messen
  useEffect(() => {
    const now = performance.now()
    const buffer = bufferRef.current

    // Intervall messen (EMA-Glättung für stabilen Wert)
    if (buffer.length > 0) {
      const lastTime = buffer[buffer.length - 1].time
      const interval = now - lastTime
      // Nur sinnvolle Intervalle (50ms - 3000ms) berücksichtigen
      if (interval > 50 && interval < 3000) {
        avgIntervalRef.current = avgIntervalRef.current === 0
          ? interval
          : avgIntervalRef.current * 0.7 + interval * 0.3
      }
    }

    const snapshot: GPSSnapshot = {
      lat: position[0],
      lon: position[1],
      heading,
      time: now
    }

    buffer.push(snapshot)

    // Sicherheitslimit — max 10 Snapshots
    while (buffer.length > 10) {
      buffer.shift()
    }
  }, [position[0], position[1], heading])

  return null
}

// Funktion zum Erstellen von Marker-Icons (für Goals, Drops, etc.)
const createMarkerIcon = (color: string, size: number = 32) => {
  return L.divIcon({
    className: 'marker-icon',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
          <path d="M16 2 L28 22 L22 22 L22 30 L10 30 L10 22 L4 22 Z" fill="${color}" stroke="#fff" stroke-width="2"/>
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

// Funktion zum Erstellen von Drop-Marker Icons (roter Punkt mit Nummer) - kleiner für bessere Übersicht
const createDropMarkerIcon = (number: number, size: number = 14) => {
  return L.divIcon({
    className: 'drop-marker-icon',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      ">
        <svg width="${size}" height="${size}" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" fill="#ef4444" stroke="#fff" stroke-width="1.5"/>
        </svg>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: white;
          font-size: 8px;
          font-weight: 700;
          font-family: monospace;
        ">${number}</div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

// Marker Icons - alle als Pfeile
const goalIcon = createMarkerIcon('#1a73e8', 28)  // Blau für Goals
const waypointIcon = createMarkerIcon('#f59e0b', 24)  // Orange für Waypoints

// Icon Cache für Task Goals mit LRU-Limit (max 200 Einträge)
const ICON_CACHE_MAX = 200
const goalIconCache = new Map<string, L.DivIcon>()

// Globale Variable um Marker-Klicks zu tracken (für Canvas-Rendering wo stopPropagation nicht funktioniert)
let lastMarkerClickTime = 0

// Draggable Goal Marker Komponente - verwaltet eigene Position während Drag
interface DraggableGoalMarkerProps {
  goalId: string
  position: { latitude: number; longitude: number }
  icon: L.DivIcon
  draggable: boolean
  zIndexOffset?: number
  onDragEnd: (goalId: string, lat: number, lng: number) => void
  onClick?: (e: L.LeafletMouseEvent) => void
  onDblClick?: (e: L.LeafletMouseEvent) => void
  measureModeActive?: boolean
  onMeasureClick?: (lat: number, lon: number) => void
}

const DraggableGoalMarker = React.memo(function DraggableGoalMarker({
  goalId,
  position,
  icon,
  draggable,
  zIndexOffset = 500,
  onDragEnd,
  onClick,
  onDblClick,
  measureModeActive,
  onMeasureClick
}: DraggableGoalMarkerProps) {
  const [localPosition, setLocalPosition] = useState<[number, number]>([position.latitude, position.longitude])
  const [isDragging, setIsDragging] = useState(false)
  const markerRef = useRef<L.Marker>(null)

  // Position nur aktualisieren wenn nicht gerade gedraggt wird
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition([position.latitude, position.longitude])
    }
  }, [position.latitude, position.longitude, isDragging])

  const eventHandlers = useMemo(() => ({
    click: (e: L.LeafletMouseEvent) => {
      // Setze globalen Timestamp für Marker-Klick (für Canvas-Rendering wo stopPropagation nicht funktioniert)
      lastMarkerClickTime = Date.now()
      e.originalEvent.stopPropagation()

      // Bei aktivem Messmodus: direkt zur Messung hinzufügen (Snap auf Goal-Position)
      if (measureModeActive && onMeasureClick) {
        onMeasureClick(position.latitude, position.longitude)
        return
      }
      // Sonst normaler Klick-Handler
      if (onClick) onClick(e)
    },
    dblclick: (e: L.LeafletMouseEvent) => {
      // Setze globalen Timestamp für Marker-Klick
      lastMarkerClickTime = Date.now()
      e.originalEvent.stopPropagation()
      if (onDblClick) onDblClick(e)
    },
    dragstart: () => {
      setIsDragging(true)
    },
    drag: (e: L.LeafletEvent) => {
      const marker = e.target as L.Marker
      const pos = marker.getLatLng()
      setLocalPosition([pos.lat, pos.lng])
    },
    dragend: (e: L.LeafletEvent) => {
      setIsDragging(false)
      const marker = e.target as L.Marker
      const pos = marker.getLatLng()
      onDragEnd(goalId, pos.lat, pos.lng)
    }
  }), [goalId, onDragEnd, onClick, onDblClick, measureModeActive, onMeasureClick, position.latitude, position.longitude])

  return (
    <Marker
      ref={markerRef}
      position={localPosition}
      draggable={draggable}
      icon={icon}
      zIndexOffset={zIndexOffset}
      eventHandlers={eventHandlers}
    />
  )
})

function getGoalIcon(
  taskLabel: string,
  goalName: string,
  isActive: boolean,
  isEditing: boolean,
  isSelected: boolean,
  markerColor?: string,
  crossColor: string = '#000000',
  crossSize: number = 24,
  crossStrokeWidth: number = 3,
  labelFontSize: number = 14,
  labelPadding: number = 6,
  loggerId?: string,
  loggerGoalId?: string,  // LG Badge
  markerColors?: string[],  // Multi-Marker Farben
  loggerBadgeColor: string = '#10b981',  // LM Badge Farbe
  loggerGoalBadgeColor: string = '#f59e0b',  // LG Badge Farbe (orange)
  loggerBadgeFontSize: number = 11,  // LM Badge Schriftgröße
  loggerGoalBadgeFontSize: number = 11  // LG Badge Schriftgröße
): L.DivIcon {
  const cacheKey = `v4-${taskLabel}-${goalName}-${isActive}-${isEditing}-${isSelected}-${markerColor || 'default'}-${crossColor}-${crossSize}-${crossStrokeWidth}-${labelFontSize}-${labelPadding}-${loggerId || ''}-${loggerGoalId || ''}-${markerColors?.join(',') || ''}-${loggerBadgeColor}-${loggerGoalBadgeColor}-${loggerBadgeFontSize}-${loggerGoalBadgeFontSize}`

  if (goalIconCache.has(cacheKey)) {
    return goalIconCache.get(cacheKey)!
  }

  const defaultBgColor = markerColor || (isSelected ? '#1a73e8' : (isActive ? '#f59e0b' : '#3b82f6'))
  const borderColor = isEditing ? '#f59e0b' : (isSelected ? '#22c55e' : 'white')
  const borderWidth = isSelected ? 3 : 2

  // Badge-Größen aus Einstellungen (LM und LG separat)
  const lmFontSize = loggerBadgeFontSize
  const lmPadding = Math.round(lmFontSize * 0.5)
  const lgFontSize = loggerGoalBadgeFontSize
  const lgPadding = Math.round(lgFontSize * 0.5)

  // Berechne die Gesamthöhe und Position
  // Label: padding * 2 + fontSize + border
  // Margin: 8px
  // Kreuz: crossSize (z.B. 24px)
  const labelHeight = labelPadding * 2 + labelFontSize + borderWidth * 2
  const margin = 8
  const totalHeight = labelHeight + margin + crossSize

  // Der Anchor-Punkt ist die Mitte des Kreuzes
  // Das ist: labelHeight + margin + (crossSize / 2)
  // Das Badge ist absolut positioniert und beeinflusst den Anchor nicht
  const anchorY = labelHeight + margin + (crossSize / 2)

  // Horizontaler Anchor ist immer die Mitte - berechne dynamische Breite
  const horizontalPadding = labelPadding * 2  // horizontales Padding ist doppelt so groß
  const iconWidth = Math.max(100, labelFontSize * 8 + horizontalPadding)  // Dynamische Breite basierend auf Schriftgröße
  const anchorX = iconWidth / 2

  // Badge HTML nur wenn loggerId oder loggerGoalId vorhanden
  // Badges sitzen höher oben - komplette Badge-Höhe + extra Abstand
  const maxBadgeFontSize = Math.max(lmFontSize, lgFontSize)
  const maxBadgePadding = Math.round(maxBadgeFontSize * 0.5)
  const badgeHeight = maxBadgeFontSize + maxBadgePadding * 2 + 4
  const badgeOffsetTop = badgeHeight + 4

  // LM Badge (rechts)
  const lmBadgeHtml = loggerId ? `
    <div style="
      position: absolute;
      top: -${badgeOffsetTop}px;
      right: -${lmFontSize / 2}px;
      background: linear-gradient(135deg, ${loggerBadgeColor} 0%, ${loggerBadgeColor}dd 100%);
      color: white;
      padding: ${lmPadding}px ${lmPadding + 2}px;
      border-radius: 999px;
      font-size: ${lmFontSize}px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      border: 2px solid white;
      line-height: 1;
    ">${loggerId}</div>
  ` : ''

  // LG Badge (links)
  const lgBadgeHtml = loggerGoalId ? `
    <div style="
      position: absolute;
      top: -${badgeOffsetTop}px;
      left: -${lgFontSize / 2}px;
      background: linear-gradient(135deg, ${loggerGoalBadgeColor} 0%, ${loggerGoalBadgeColor}dd 100%);
      color: white;
      padding: ${lgPadding}px ${lgPadding + 2}px;
      border-radius: 999px;
      font-size: ${lgFontSize}px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      border: 2px solid white;
      line-height: 1;
    ">${loggerGoalId}</div>
  ` : ''

  // Kombiniertes Badge HTML
  const badgeHtml = lmBadgeHtml + lgBadgeHtml

  // Multi-Marker: Hintergrund mit Gradient aus mehreren Farben
  let bgStyle: string
  if (markerColors && markerColors.length > 1) {
    // Erstelle horizontalen Streifen-Gradient
    const gradientStops = markerColors.map((color, i) => {
      const startPercent = (i / markerColors.length) * 100
      const endPercent = ((i + 1) / markerColors.length) * 100
      return `${color} ${startPercent}%, ${color} ${endPercent}%`
    }).join(', ')
    bgStyle = `background: linear-gradient(to right, ${gradientStops});`
  } else {
    bgStyle = `background: ${defaultBgColor};`
  }

  // Kreuz wird absolut positioniert - Anchor ist genau die Mitte des Kreuzes
  // Das Label sitzt oberhalb des Kreuzes
  const icon = L.divIcon({
    className: isSelected ? 'task-goal-marker-selected' : 'task-goal-marker',
    html: `
      <div style="
        position: relative;
        width: ${iconWidth}px;
        height: ${totalHeight}px;
        cursor: ${isEditing ? 'move' : 'pointer'};
      ">
        <div style="
          position: absolute;
          left: 50%;
          top: 0;
          transform: translateX(-50%);
          ${bgStyle}
          color: white;
          padding: ${labelPadding}px ${horizontalPadding}px;
          border-radius: 8px;
          font-size: ${labelFontSize}px;
          font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          border: ${borderWidth}px solid ${borderColor};
        ">
          ${isEditing ? '✎ ' : ''}${taskLabel}${goalName}
          ${badgeHtml}
        </div>
        <svg
          width="${crossSize}"
          height="${crossSize}"
          viewBox="0 0 ${crossSize} ${crossSize}"
          style="
            position: absolute;
            left: 50%;
            bottom: 0;
            transform: translateX(-50%);
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
          "
        >
          <line x1="${crossSize / 2}" y1="${crossSize * 0.167}" x2="${crossSize / 2}" y2="${crossSize * 0.833}" stroke="${crossColor}" stroke-width="${crossStrokeWidth}" />
          <line x1="${crossSize * 0.167}" y1="${crossSize / 2}" x2="${crossSize * 0.833}" y2="${crossSize / 2}" stroke="${crossColor}" stroke-width="${crossStrokeWidth}" />
        </svg>
      </div>
    `,
    iconSize: [iconWidth, totalHeight],
    // Anchor: horizontal Mitte, vertikal am unteren Rand minus halbe Kreuzgröße
    iconAnchor: [iconWidth / 2, totalHeight - crossSize / 2]
  })

  if (goalIconCache.size >= ICON_CACHE_MAX) {
    const firstKey = goalIconCache.keys().next().value
    if (firstKey) goalIconCache.delete(firstKey)
  }
  goalIconCache.set(cacheKey, icon)
  return icon
}

// Click Marker Icon (temporär)
const clickIcon = L.divIcon({
  className: 'click-marker',
  html: `
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <circle cx="15" cy="15" r="12" fill="none" stroke="#22c55e" stroke-width="3" stroke-dasharray="4 2"/>
      <circle cx="15" cy="15" r="4" fill="#22c55e"/>
    </svg>
  `,
  iconSize: [30, 30],
  iconAnchor: [15, 15]
})

interface MapViewProps {
  onMapClick?: (lat: number, lon: number) => void
  clickedPosition?: { lat: number; lon: number } | null
  briefingOpen?: boolean
  drawingMode?: 'none' | 'circle' | 'freehand' | 'line'
  onDrawingModeChange?: (mode: 'none' | 'circle' | 'freehand' | 'line') => void
  gridSnapping?: boolean
  gridSize?: number
  startPointTrigger?: { lat: number; lon: number } | null
  onOpenMaps?: () => void
  onOpenMarkerSettings?: () => void
}

// Grid Overlay Komponente - zeigt UTM Grid mit GERADEN Linien (wie OziExplorer)
// Verwendet Canvas-Layer für pixel-genaue gerade Linien statt geodätischer Polylines
interface GridOverlayProps {
  gridSize: number
  utmZone: number
  minZoom?: number
  competitionBounds?: { north: number; south: number; east: number; west: number } | null
  showLabels?: boolean
  lineColor?: string
  lineWidth?: number
  lineOpacity?: number
  lineDashed?: boolean
  labelColor?: string
  labelSize?: number
}

function GridOverlay({
  gridSize,
  utmZone,
  minZoom = 8,
  competitionBounds,
  showLabels = false,
  lineColor = '#3b82f6',
  lineWidth = 1,
  lineOpacity = 0.6,
  lineDashed = true,
  labelColor = '#1e40af',
  labelSize = 10
}: GridOverlayProps) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [labelMarkers, setLabelMarkers] = useState<Array<{ position: [number, number]; label: string; type: 'easting' | 'northing' }>>([])
  const [showingLabels, setShowingLabels] = useState(false)

  useEffect(() => {
    // Canvas-Element erstellen und zum Map-Container hinzufügen
    let canvas = canvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '650'
      const container = map.getContainer()
      container.appendChild(canvas)
      canvasRef.current = canvas
    }

    const updateGrid = () => {
      if (!canvas) return

      const zoom = map.getZoom()
      const size = map.getSize()

      // Canvas-Größe anpassen
      canvas.width = size.x
      canvas.height = size.y

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Canvas leeren
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Dynamisches minZoom basierend auf gridSize
      // Größere Grids können früher angezeigt werden
      const effectiveMinZoom = gridSize >= 1000 ? 6 : gridSize >= 500 ? 8 : 10

      if (zoom < effectiveMinZoom) {
        setLabelMarkers([])
        setShowingLabels(false)
        return
      }

      const mapBounds = map.getBounds()
      const labels: Array<{ position: [number, number]; label: string; type: 'easting' | 'northing' }> = []

      const centerLat = mapBounds.getCenter().lat
      const centerLon = mapBounds.getCenter().lng
      const hemisphere: 'N' | 'S' = centerLat >= 0 ? 'N' : 'S'

      // Berechne die korrekte UTM-Zone aus der Kartenposition
      // UTM Zone = floor((lon + 180) / 6) + 1
      const calculatedZone = Math.floor((centerLon + 180) / 6) + 1
      const effectiveUtmZone = (utmZone >= 1 && utmZone <= 60) ? utmZone : calculatedZone

      const effectiveBounds = competitionBounds ? {
        south: Math.max(mapBounds.getSouth(), competitionBounds.south),
        north: Math.min(mapBounds.getNorth(), competitionBounds.north),
        west: Math.max(mapBounds.getWest(), competitionBounds.west),
        east: Math.min(mapBounds.getEast(), competitionBounds.east)
      } : {
        south: mapBounds.getSouth(),
        north: mapBounds.getNorth(),
        west: mapBounds.getWest(),
        east: mapBounds.getEast()
      }

      if (effectiveBounds.south >= effectiveBounds.north || effectiveBounds.west >= effectiveBounds.east) {
        setLabelMarkers([])
        setShowingLabels(false)
        return
      }

      const swCorner = latLonToUTM(effectiveBounds.south, effectiveBounds.west, effectiveUtmZone)
      const seCorner = latLonToUTM(effectiveBounds.south, effectiveBounds.east, effectiveUtmZone)
      const nwCorner = latLonToUTM(effectiveBounds.north, effectiveBounds.west, effectiveUtmZone)
      const neCorner = latLonToUTM(effectiveBounds.north, effectiveBounds.east, effectiveUtmZone)

      const allEastings = [swCorner.easting, seCorner.easting, nwCorner.easting, neCorner.easting]
      const allNorthings = [swCorner.northing, seCorner.northing, nwCorner.northing, neCorner.northing]

      const actualMinEasting = Math.min(...allEastings)
      const actualMaxEasting = Math.max(...allEastings)
      const actualMinNorthing = Math.min(...allNorthings)
      const actualMaxNorthing = Math.max(...allNorthings)

      // Berechne wie viele Linien es wären
      const rangeE = actualMaxEasting - actualMinEasting
      const rangeN = actualMaxNorthing - actualMinNorthing

      // Wähle automatisch eine passende Grid-Größe basierend auf dem sichtbaren Bereich
      // Ziel: maximal 50 Linien pro Richtung
      const maxLinesPerDirection = 50
      let effectiveGridSize = gridSize

      // Wenn zu viele Linien, erhöhe die Grid-Größe automatisch
      const possibleGridSizes = [100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000]
      for (const size of possibleGridSizes) {
        if (size >= gridSize) {
          const eastLines = Math.ceil(rangeE / size)
          const northLines = Math.ceil(rangeN / size)
          if (eastLines <= maxLinesPerDirection && northLines <= maxLinesPerDirection) {
            effectiveGridSize = size
            break
          }
        }
      }

      const minEasting = Math.floor(actualMinEasting / effectiveGridSize) * effectiveGridSize
      const maxEasting = Math.ceil(actualMaxEasting / effectiveGridSize) * effectiveGridSize
      const minNorthing = Math.floor(actualMinNorthing / effectiveGridSize) * effectiveGridSize
      const maxNorthing = Math.ceil(actualMaxNorthing / effectiveGridSize) * effectiveGridSize

      const maxLines = 200
      const eastingLines = Math.ceil((maxEasting - minEasting) / effectiveGridSize)
      const northingLines = Math.ceil((maxNorthing - minNorthing) / effectiveGridSize)

      if (eastingLines > maxLines || northingLines > maxLines) {
        setLabelMarkers([])
        setShowingLabels(false)
        return
      }

      if (eastingLines <= 0 || northingLines <= 0) {
        return
      }

      // Canvas Style setzen
      ctx.strokeStyle = lineColor
      ctx.lineWidth = lineWidth
      ctx.globalAlpha = lineOpacity
      if (lineDashed) {
        ctx.setLineDash([5, 5])
      } else {
        ctx.setLineDash([])
      }

      const totalCells = eastingLines * northingLines
      const shouldShowLabels = showLabels && totalCells <= 225

      // Sammle alle Werte
      const northingValues: number[] = []
      for (let northing = minNorthing; northing <= maxNorthing; northing += effectiveGridSize) {
        northingValues.push(northing)
      }

      const eastingValues: number[] = []
      for (let easting = minEasting; easting <= maxEasting; easting += effectiveGridSize) {
        eastingValues.push(easting)
      }

      // Zeichne GERADE Linien zwischen benachbarten Grid-Punkten
      // Vertikale Linien (konstante Easting)
      for (const easting of eastingValues) {
        for (let i = 0; i < northingValues.length - 1; i++) {
          const n1 = northingValues[i]
          const n2 = northingValues[i + 1]

          const latLon1 = utmToLatLon({ zone: effectiveUtmZone, hemisphere, easting, northing: n1 })
          const latLon2 = utmToLatLon({ zone: effectiveUtmZone, hemisphere, easting, northing: n2 })

          const p1 = map.latLngToContainerPoint([latLon1.lat, latLon1.lon])
          const p2 = map.latLngToContainerPoint([latLon2.lat, latLon2.lon])

          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          // Easting Label in der Mitte des Segments
          if (shouldShowLabels) {
            const midNorthing = (n1 + n2) / 2
            const labelPos = utmToLatLon({ zone: utmZone, hemisphere, easting, northing: midNorthing })
            labels.push({
              position: [labelPos.lat, labelPos.lon],
              label: Math.round(easting).toString(),
              type: 'easting'
            })
          }
        }
      }

      // Horizontale Linien (konstante Northing)
      for (const northing of northingValues) {
        for (let i = 0; i < eastingValues.length - 1; i++) {
          const e1 = eastingValues[i]
          const e2 = eastingValues[i + 1]

          const latLon1 = utmToLatLon({ zone: utmZone, hemisphere, easting: e1, northing })
          const latLon2 = utmToLatLon({ zone: utmZone, hemisphere, easting: e2, northing })

          const p1 = map.latLngToContainerPoint([latLon1.lat, latLon1.lon])
          const p2 = map.latLngToContainerPoint([latLon2.lat, latLon2.lon])

          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          // Northing Label in der Mitte des Segments
          if (shouldShowLabels) {
            const midEasting = (e1 + e2) / 2
            const labelPos = utmToLatLon({ zone: utmZone, hemisphere, easting: midEasting, northing })
            labels.push({
              position: [labelPos.lat, labelPos.lon],
              label: Math.round(northing).toString(),
              type: 'northing'
            })
          }
        }
      }

      setLabelMarkers(labels)
      setShowingLabels(shouldShowLabels)
    }

    updateGrid()
    map.on('move', updateGrid)
    map.on('zoom', updateGrid)
    map.on('moveend', updateGrid)
    map.on('zoomend', updateGrid)

    return () => {
      map.off('move', updateGrid)
      map.off('zoom', updateGrid)
      map.off('moveend', updateGrid)
      map.off('zoomend', updateGrid)
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
      canvasRef.current = null
    }
  }, [map, gridSize, utmZone, minZoom, competitionBounds?.north, competitionBounds?.south, competitionBounds?.east, competitionBounds?.west, showLabels, lineColor, lineWidth, lineOpacity, lineDashed])

  return (
    <>
      {/* Easting Labels - VERTIKAL */}
      {showingLabels && labelMarkers.filter(l => l.type === 'easting').map((label, index) => (
        <Marker
          key={`grid-east-${index}`}
          position={label.position}
          zIndexOffset={500}
          icon={L.divIcon({
            className: 'utm-grid-label-east',
            html: `<div style="
              font-size: ${labelSize}px;
              font-family: monospace;
              font-weight: 700;
              color: ${labelColor};
              white-space: nowrap;
              pointer-events: none;
              text-shadow: 1px 1px 0 white, -1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white;
              writing-mode: vertical-rl;
              text-orientation: mixed;
              transform: rotate(180deg);
            ">${label.label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [6, 0]
          })}
          interactive={false}
        />
      ))}
      {/* Northing Labels - HORIZONTAL */}
      {showingLabels && labelMarkers.filter(l => l.type === 'northing').map((label, index) => (
        <Marker
          key={`grid-north-${index}`}
          position={label.position}
          zIndexOffset={500}
          icon={L.divIcon({
            className: 'utm-grid-label-north',
            html: `<div style="
              font-size: ${labelSize}px;
              font-family: monospace;
              font-weight: 700;
              color: ${labelColor};
              white-space: nowrap;
              pointer-events: none;
              text-shadow: 1px 1px 0 white, -1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white;
            ">${label.label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 6]
          })}
          interactive={false}
        />
      ))}
    </>
  )
}

/**
 * UTM Grid Overlay für Competition Maps
 * Zeichnet ein 1x1km UTM-Grid über die WGS84-Karte
 * Das Grid ist leicht schräg (Meridiankonvergenz), aber die Karte bleibt unverzerrt
 */
interface StraightGridOverlayProps {
  bounds: { north: number; south: number; east: number; west: number }
  gridSizeMeters?: number  // Default: 1000m (1km)
  lineColor?: string
  lineWidth?: number
  lineOpacity?: number
  showLabels?: boolean
  utmZone?: number
}

function StraightGridOverlay({
  bounds,
  gridSizeMeters = 1000,
  lineColor = '#0066ff',
  lineWidth = 1.5,
  lineOpacity = 0.8,
  utmZone
}: StraightGridOverlayProps) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { settings } = useFlightStore()

  // UTM Zone bestimmen
  const centerLon = (bounds.west + bounds.east) / 2
  const calculatedZone = Math.floor((centerLon + 180) / 6) + 1
  const validSettingsZone = settings.utmZone >= 1 && settings.utmZone <= 60 ? settings.utmZone : null
  const effectiveUtmZone = utmZone || validSettingsZone || calculatedZone

  useEffect(() => {
    let canvas = canvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '655'
      const container = map.getContainer()
      container.appendChild(canvas)
      canvasRef.current = canvas
    }

    const updateGrid = () => {
      if (!canvas) return

      const size = map.getSize()
      canvas.width = size.x
      canvas.height = size.y

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const centerLat = (bounds.north + bounds.south) / 2
      const hemisphere: 'N' | 'S' = centerLat >= 0 ? 'N' : 'S'

      // Berechne UTM Bounds aus WGS84 Bounds
      const swUtm = latLonToUTM(bounds.south, bounds.west, effectiveUtmZone)
      const seUtm = latLonToUTM(bounds.south, bounds.east, effectiveUtmZone)
      const nwUtm = latLonToUTM(bounds.north, bounds.west, effectiveUtmZone)
      const neUtm = latLonToUTM(bounds.north, bounds.east, effectiveUtmZone)

      const minEasting = Math.floor(Math.min(swUtm.easting, nwUtm.easting) / gridSizeMeters) * gridSizeMeters
      const maxEasting = Math.ceil(Math.max(seUtm.easting, neUtm.easting) / gridSizeMeters) * gridSizeMeters
      const minNorthing = Math.floor(Math.min(swUtm.northing, seUtm.northing) / gridSizeMeters) * gridSizeMeters
      const maxNorthing = Math.ceil(Math.max(nwUtm.northing, neUtm.northing) / gridSizeMeters) * gridSizeMeters

      // Pixel-Koordinaten der Bounds-Ecken für den Rahmen
      const swPx = map.latLngToContainerPoint([bounds.south, bounds.west])
      const sePx = map.latLngToContainerPoint([bounds.south, bounds.east])
      const nwPx = map.latLngToContainerPoint([bounds.north, bounds.west])
      const nePx = map.latLngToContainerPoint([bounds.north, bounds.east])

      // Grid-Linien zeichnen
      ctx.strokeStyle = lineColor
      ctx.lineWidth = lineWidth
      ctx.globalAlpha = lineOpacity

      // Interpolationsschritte für Linien (folgen der UTM-Kurve in WGS84)
      const steps = 2

      // Zeichne vertikale Linien (konstantes Easting)
      for (let easting = minEasting; easting <= maxEasting; easting += gridSizeMeters) {
        const isMajor = easting % (gridSizeMeters * 5) === 0

        ctx.lineWidth = isMajor ? lineWidth + 1 : lineWidth
        ctx.setLineDash(isMajor ? [] : [5, 5])

        ctx.beginPath()

        for (let i = 0; i <= steps; i++) {
          const northing = minNorthing + (maxNorthing - minNorthing) * (i / steps)
          const latLon = utmToLatLon({ zone: effectiveUtmZone, hemisphere, easting, northing })
          const px = map.latLngToContainerPoint([latLon.lat, latLon.lon])

          if (i === 0) {
            ctx.moveTo(px.x, px.y)
          } else {
            ctx.lineTo(px.x, px.y)
          }
        }
        ctx.stroke()
      }

      // Zeichne horizontale Linien (konstantes Northing)
      for (let northing = minNorthing; northing <= maxNorthing; northing += gridSizeMeters) {
        const isMajor = northing % (gridSizeMeters * 5) === 0

        ctx.lineWidth = isMajor ? lineWidth + 1 : lineWidth
        ctx.setLineDash(isMajor ? [] : [5, 5])

        ctx.beginPath()

        for (let i = 0; i <= steps; i++) {
          const easting = minEasting + (maxEasting - minEasting) * (i / steps)
          const latLon = utmToLatLon({ zone: effectiveUtmZone, hemisphere, easting, northing })
          const px = map.latLngToContainerPoint([latLon.lat, latLon.lon])

          if (i === 0) {
            ctx.moveTo(px.x, px.y)
          } else {
            ctx.lineTo(px.x, px.y)
          }
        }
        ctx.stroke()
      }

      // Labels an 5km Grid-Linien
      ctx.font = 'bold 10px monospace'
      ctx.globalAlpha = 1.0
      ctx.setLineDash([])

      // Easting Labels (am unteren Rand)
      for (let easting = minEasting; easting <= maxEasting; easting += gridSizeMeters * 5) {
        const latLon = utmToLatLon({ zone: effectiveUtmZone, hemisphere, easting, northing: minNorthing })
        const px = map.latLngToContainerPoint([latLon.lat, latLon.lon])

        const label = `${Math.round(easting / 1000)}`
        const textWidth = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fillRect(px.x - textWidth / 2 - 3, px.y + 4, textWidth + 6, 14)
        ctx.fillStyle = '#0044aa'
        ctx.fillText(label, px.x - textWidth / 2, px.y + 15)
      }

      // Northing Labels (am linken Rand)
      for (let northing = minNorthing; northing <= maxNorthing; northing += gridSizeMeters * 5) {
        const latLon = utmToLatLon({ zone: effectiveUtmZone, hemisphere, easting: minEasting, northing })
        const px = map.latLngToContainerPoint([latLon.lat, latLon.lon])

        const label = `${Math.round(northing / 1000)}`
        const textWidth = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fillRect(px.x - textWidth - 8, px.y - 7, textWidth + 6, 14)
        ctx.fillStyle = '#0044aa'
        ctx.fillText(label, px.x - textWidth - 5, px.y + 4)
      }

      // Rahmen um Competition Area (grün)
      ctx.globalAlpha = 1.0
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 3
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(nwPx.x, nwPx.y)
      ctx.lineTo(nePx.x, nePx.y)
      ctx.lineTo(sePx.x, sePx.y)
      ctx.lineTo(swPx.x, swPx.y)
      ctx.closePath()
      ctx.stroke()
    }

    updateGrid()
    map.on('move', updateGrid)
    map.on('zoom', updateGrid)
    map.on('moveend', updateGrid)
    map.on('zoomend', updateGrid)

    return () => {
      map.off('move', updateGrid)
      map.off('zoom', updateGrid)
      map.off('moveend', updateGrid)
      map.off('zoomend', updateGrid)
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
      canvasRef.current = null
    }
  }, [map, bounds, gridSizeMeters, lineColor, lineWidth, lineOpacity, effectiveUtmZone])

  return null
}

// Komponente um Karte zu zentrieren — "Render In The Past" (wie Marker)
function MapCenterUpdater({ followBalloon }: { followBalloon: boolean }) {
  const map = useMap()
  const { gpsData, smoothedGpsData } = useFlightStore()
  const hadGpsRef = React.useRef(false)
  const bufferRef = React.useRef<{ lat: number; lon: number; time: number }[]>([])
  const animFrameRef = React.useRef<number>(0)
  const avgIntervalRef = React.useRef<number>(0)

  const displayData = smoothedGpsData || gpsData

  // Animation Loop — gleicher "Render in the Past" wie der Marker
  const animateMapRef = React.useRef<() => void>()
  animateMapRef.current = () => {
    if (!followBalloon) return
    const buffer = bufferRef.current
    if (buffer.length < 2) {
      if (buffer.length === 1) {
        map.setView([buffer[0].lat, buffer[0].lon], map.getZoom(), { animate: false })
      }
      animFrameRef.current = requestAnimationFrame(animateMapRef.current!)
      return
    }

    const now = performance.now()
    const measuredInterval = avgIntervalRef.current
    const renderTime = now - (measuredInterval > 0 ? measuredInterval + 50 : 250)

    let before: typeof buffer[0] | null = null
    let after: typeof buffer[0] | null = null
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].time <= renderTime && buffer[i + 1].time >= renderTime) {
        before = buffer[i]
        after = buffer[i + 1]
        break
      }
    }

    if (before && after) {
      const segDur = after.time - before.time
      const t = segDur > 0 ? Math.min((renderTime - before.time) / segDur, 1.0) : 1.0
      const lat = before.lat + (after.lat - before.lat) * t
      const lon = before.lon + (after.lon - before.lon) * t
      map.setView([lat, lon], map.getZoom(), { animate: false })

      // Alte Einträge aufräumen
      const beforeIdx = buffer.indexOf(before)
      if (beforeIdx > 0) buffer.splice(0, beforeIdx)
    } else if (buffer.length >= 2) {
      const last = buffer[buffer.length - 1]
      map.setView([last.lat, last.lon], map.getZoom(), { animate: false })
    }

    animFrameRef.current = requestAnimationFrame(animateMapRef.current!)
  }

  // Animation starten/stoppen
  useEffect(() => {
    if (followBalloon && bufferRef.current.length > 0) {
      animFrameRef.current = requestAnimationFrame(animateMapRef.current!)
    }
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [followBalloon])

  // Neues GPS empfangen → in Buffer
  useEffect(() => {
    if (!displayData) {
      hadGpsRef.current = false
      return
    }

    if (!hadGpsRef.current) {
      hadGpsRef.current = true
      bufferRef.current = [{ lat: displayData.latitude, lon: displayData.longitude, time: performance.now() }]
      if (followBalloon) {
        map.flyTo([displayData.latitude, displayData.longitude], 15, { duration: 1.5 })
        setTimeout(() => {
          animFrameRef.current = requestAnimationFrame(animateMapRef.current!)
        }, 1600)
      }
      return
    }

    const now = performance.now()
    const buf = bufferRef.current
    // Intervall messen
    if (buf.length > 0) {
      const interval = now - buf[buf.length - 1].time
      if (interval > 50 && interval < 3000) {
        avgIntervalRef.current = avgIntervalRef.current === 0
          ? interval : avgIntervalRef.current * 0.7 + interval * 0.3
      }
    }
    buf.push({ lat: displayData.latitude, lon: displayData.longitude, time: now })
    while (buf.length > 10) buf.shift()
  }, [displayData?.latitude, displayData?.longitude, followBalloon])

  // Reset wenn GPS verloren
  useEffect(() => {
    if (!gpsData) {
      hadGpsRef.current = false
      bufferRef.current = []
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [gpsData])

  return null
}

// Verfügbare Schrittgrößen für Pfeiltasten
type MoveStepSize = 10 | 100 | 1000

// Komponente für Keyboard Navigation (Pfeiltasten zum Verschieben des Goals)
interface KeyboardNavigationProps {
  editingGoal: Goal | null  // Das aktuell bearbeitete Goal
  onMoveGoal: (goalId: string, lat: number, lon: number) => void
  editMode: boolean // Nur aktiv wenn editMode true ist
  moveStepSize: MoveStepSize // Schrittgröße in Metern (10, 100, 1000)
}

function KeyboardNavigation({ editingGoal, onMoveGoal, editMode, moveStepSize }: KeyboardNavigationProps) {
  useEffect(() => {
    // Nur wenn ein Goal bearbeitet wird UND Edit-Modus aktiv
    if (!editingGoal || !editMode) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Nur wenn kein Input-Feld fokussiert ist
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Bewegungsschritt in Metern (vom Benutzer ausgewählt)
      const moveMeters = moveStepSize

      // Umrechnung: 1 Grad Lat ≈ 111km
      const latMove = moveMeters / 111000
      // Lon korrigiert für Breitengrad
      const lonMove = moveMeters / (111000 * Math.cos(editingGoal.position.latitude * Math.PI / 180))

      let newLat = editingGoal.position.latitude
      let newLon = editingGoal.position.longitude
      let moved = false

      switch (e.key) {
        case 'ArrowUp':
          newLat += latMove
          moved = true
          break
        case 'ArrowDown':
          newLat -= latMove
          moved = true
          break
        case 'ArrowLeft':
          newLon -= lonMove
          moved = true
          break
        case 'ArrowRight':
          newLon += lonMove
          moved = true
          break
      }

      if (moved) {
        e.preventDefault()
        onMoveGoal(editingGoal.id, newLat, newLon)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingGoal, onMoveGoal, editMode, moveStepSize])

  return null
}

// Komponente für Klick-Events und Maus-Bewegung
interface MapClickHandlerProps {
  onMapClick?: (lat: number, lon: number) => void
  hdgCourseMode?: boolean
  hdgPendingCourse?: number | null
  hdgPendingLineMode?: 'from' | 'to' | 'extended'
  onSetHdgCourseLine?: (line: { startPosition: { lat: number; lon: number }; course: number; lineMode: 'from' | 'to' | 'extended' }) => void
  editingHdgCourseLineId?: string | null
  onUpdateHdgCourseLine?: (id: string, updates: { startPosition: { lat: number; lon: number } }) => void
  // Snapping data for course lines
  tasksForSnap?: Task[]
  waypointsForSnap?: Waypoint[]
  windLineMode?: boolean
  pendingWindLayer?: WindLayer | null
  onSetWindLine?: (line: { startPosition: { lat: number; lon: number }; windLayer: WindLayer }) => void
  drawingMode?: 'none' | 'circle' | 'freehand' | 'line'
  onDrawClick?: (lat: number, lon: number) => void
  onMeasureClick?: (lat: number, lon: number) => void
  measureMode?: boolean
  onMouseMove?: (lat: number, lon: number) => void
  onMouseOut?: () => void
  gpsSimPickingStart?: boolean
  onGpsSimStartPicked?: (lat: number, lon: number) => void
  onDragStart?: () => void
  pzDrawMode?: boolean
  onPzDrawClick?: (lat: number, lon: number) => void
  windImportPickPosition?: boolean
  onWindImportPositionPicked?: (lat: number, lon: number) => void
}

// Helper component to capture map reference
function MapRefSetter({ onMapReady }: { onMapReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onMapReady(map)
  }, [map, onMapReady])
  return null
}

// Schraffur-Komponente für MMA-Kreise (diagonale Linien)
function CircleHatch({ center, radius, color, lineSpacing = 20 }: {
  center: [number, number]
  radius: number
  color: string
  lineSpacing?: number
}) {
  const map = useMap()
  const [lines, setLines] = useState<Array<[[number, number], [number, number]]>>([])

  useEffect(() => {
    // Sicherheitsprüfung - Map muss vollständig initialisiert sein
    if (!map || !map.getContainer() || !map.getPane('mapPane')) {
      return
    }

    // Berechne Linien basierend auf aktuellem Zoom
    const updateLines = () => {
      try {
        if (!map.getContainer()) return
      } catch {
        return
      }

      const zoom = map.getZoom()

      // Berechne Meter pro Pixel bei aktuellem Zoom
      const metersPerPixel = 40075016.686 * Math.abs(Math.cos(center[0] * Math.PI / 180)) / Math.pow(2, zoom + 8)

      // Linienabstand in Metern (basierend auf Pixel-Abstand)
      const spacingMeters = lineSpacing * metersPerPixel

      // Umrechnung Faktoren
      const metersToDegLat = 1 / 111320
      const metersToDegLon = 1 / (111320 * Math.cos(center[0] * Math.PI / 180))

      const newLines: Array<[[number, number], [number, number]]> = []

      // Diagonale Linien (45°) - von links-unten nach rechts-oben
      // d ist der senkrechte Abstand der Linie vom Kreismittelpunkt
      const numLines = Math.ceil(radius / spacingMeters)

      for (let i = -numLines; i <= numLines; i++) {
        const d = i * spacingMeters  // Abstand vom Zentrum

        // Für eine Linie mit Abstand d vom Zentrum:
        // Die Schnittpunkte mit dem Kreis liegen bei ±sqrt(r² - d²) entlang der Linie
        if (Math.abs(d) < radius) {
          const halfChord = Math.sqrt(radius * radius - d * d)

          // Richtung der Linie (45°): (1, 1) / sqrt(2)
          // Senkrechte dazu: (-1, 1) / sqrt(2)
          const sqrt2 = Math.SQRT2

          // Mittelpunkt der Linie (auf der Senkrechten vom Zentrum)
          const midX = -d / sqrt2  // x-Komponente
          const midY = d / sqrt2   // y-Komponente

          // Endpunkte der Linie
          const x1 = midX - halfChord / sqrt2
          const y1 = midY - halfChord / sqrt2
          const x2 = midX + halfChord / sqrt2
          const y2 = midY + halfChord / sqrt2

          const lat1 = center[0] + y1 * metersToDegLat
          const lon1 = center[1] + x1 * metersToDegLon
          const lat2 = center[0] + y2 * metersToDegLat
          const lon2 = center[1] + x2 * metersToDegLon

          newLines.push([[lat1, lon1], [lat2, lon2]])
        }
      }

      setLines(newLines)
    }

    const timer = setTimeout(updateLines, 100)
    map.on('zoomend', updateLines)

    return () => {
      clearTimeout(timer)
      map.off('zoomend', updateLines)
    }
  }, [map, center, radius, lineSpacing])

  return (
    <>
      {lines.map((line, index) => (
        <Polyline
          key={`hatch-${index}`}
          positions={line}
          pathOptions={{
            color: color,
            weight: 1.5,
            opacity: 0.5
          }}
        />
      ))}
    </>
  )
}

// Helper component to center map ONCE when a competition map is activated
// Kein Zoom-Limit - man kann beliebig raus- und reinzoomen wie bei OZI
function CompetitionMapBoundsController({ bounds }: { bounds: { north: number; south: number; east: number; west: number } | null }) {
  const map = useMap()
  // Speichere welche Bounds-ID bereits zentriert wurde (überlebt Re-Renders)
  const centeredBoundsIdRef = useRef<string | null>(null)

  // Erstelle eine stabile ID für die aktuellen Bounds
  const currentBoundsId = bounds
    ? `${bounds.north.toFixed(6)}-${bounds.south.toFixed(6)}-${bounds.east.toFixed(6)}-${bounds.west.toFixed(6)}`
    : null

  useEffect(() => {
    if (bounds && currentBoundsId) {
      const latLngBounds = L.latLngBounds(
        [bounds.south, bounds.west],
        [bounds.north, bounds.east]
      )

      // Nur fliegen wenn diese Bounds noch nicht zentriert wurden (neue Competition Map)
      if (currentBoundsId !== centeredBoundsIdRef.current) {
        // Fliege zu den Bounds mit angemessenem Zoom
        map.flyToBounds(latLngBounds, { padding: [20, 20], maxZoom: 14 })
        centeredBoundsIdRef.current = currentBoundsId
      }

      // KEIN minZoom Limit - Nutzer kann beliebig rauszoomen (wie bei OZI)
      // KEIN maxBounds - Nutzer kann die Karte frei bewegen
    } else {
      // Reset wenn keine Competition Map aktiv
      centeredBoundsIdRef.current = null
    }
  }, [map, currentBoundsId, bounds])

  return null
}

function MapClickHandler({ onMapClick, hdgCourseMode, hdgPendingCourse, hdgPendingLineMode, onSetHdgCourseLine, editingHdgCourseLineId, onUpdateHdgCourseLine, tasksForSnap, waypointsForSnap, windLineMode, pendingWindLayer, onSetWindLine, drawingMode, onDrawClick, onMeasureClick, measureMode, onMouseMove, onMouseOut, gpsSimPickingStart, onGpsSimStartPicked, onDragStart, pzDrawMode, onPzDrawClick, windImportPickPosition, onWindImportPositionPicked }: MapClickHandlerProps) {
  useMapEvents({
    dragstart: () => {
      if (onDragStart) onDragStart()
    },
    click: (e) => {
      // Wind Import Position wählen
      if (windImportPickPosition && onWindImportPositionPicked) {
        onWindImportPositionPicked(e.latlng.lat, e.latlng.lng)
        return
      }

      // GPS Simulation Startpunkt wählen
      if (gpsSimPickingStart && onGpsSimStartPicked) {
        onGpsSimStartPicked(e.latlng.lat, e.latlng.lng)
        return
      }

      // PZ Polygon-Zeichenmodus
      if (pzDrawMode && onPzDrawClick) {
        onPzDrawClick(e.latlng.lat, e.latlng.lng)
        return
      }

      // Shift+Klick oder Messmodus für Messwerkzeug
      if ((e.originalEvent.shiftKey || measureMode) && onMeasureClick) {
        onMeasureClick(e.latlng.lat, e.latlng.lng)
        return
      }

      // Wenn Zeichen-Modus aktiv, Zeichen-Klick verarbeiten
      // ABER: Ignoriere Klicks wenn kürzlich auf einen Marker geklickt wurde (500ms für Doppelklicks)
      if (drawingMode && drawingMode !== 'none' && onDrawClick) {
        const timeSinceMarkerClick = Date.now() - lastMarkerClickTime
        if (timeSinceMarkerClick < 500) {
          return
        }
        onDrawClick(e.latlng.lat, e.latlng.lng)
        return
      }

      // Wenn Wind-Linien-Modus aktiv, Windlinie setzen
      if (windLineMode && pendingWindLayer && onSetWindLine) {
        onSetWindLine({
          startPosition: { lat: e.latlng.lat, lon: e.latlng.lng },
          windLayer: pendingWindLayer
        })
        return
      }

      // Wenn HDG-Kurs-Modus aktiv, Kurslinie setzen oder aktualisieren
      if (hdgCourseMode) {
        // Snapping zu Goals/Waypoints (10m Radius)
        const SNAP_RADIUS = 10 // Meter
        let snapLat = e.latlng.lat
        let snapLon = e.latlng.lng
        let closestDist = SNAP_RADIUS

        // Alle Goals aus Tasks sammeln
        if (tasksForSnap) {
          const allGoalsForSnap = tasksForSnap.flatMap(t => t.goals)
          for (const goal of allGoalsForSnap) {
            if (goal.position?.latitude && goal.position?.longitude) {
              const dist = haversineDistanceSimple(e.latlng.lat, e.latlng.lng, goal.position.latitude, goal.position.longitude)
              if (dist < closestDist) {
                closestDist = dist
                snapLat = goal.position.latitude
                snapLon = goal.position.longitude
              }
            }
          }
        }

        // Prüfe Waypoints
        if (waypointsForSnap) {
          for (const wp of waypointsForSnap) {
            if (wp.position?.latitude && wp.position?.longitude) {
              const dist = haversineDistanceSimple(e.latlng.lat, e.latlng.lng, wp.position.latitude, wp.position.longitude)
              if (dist < closestDist) {
                closestDist = dist
                snapLat = wp.position.latitude
                snapLon = wp.position.longitude
              }
            }
          }
        }

        // Bestehende Linie bearbeiten (Position ändern)
        if (editingHdgCourseLineId && onUpdateHdgCourseLine) {
          onUpdateHdgCourseLine(editingHdgCourseLineId, {
            startPosition: { lat: snapLat, lon: snapLon }
          })
          return
        }
        // Neue Linie erstellen
        if (hdgPendingCourse !== null && hdgPendingCourse !== undefined && onSetHdgCourseLine) {
          onSetHdgCourseLine({
            startPosition: { lat: snapLat, lon: snapLon },
            course: hdgPendingCourse,
            lineMode: hdgPendingLineMode || 'from'
          })
          return
        }
      }

      // Wettkampfbereich-Punkt setzen (wenn Panel aktiv)
      if ((window as any).setCompetitionCorner) {
        (window as any).setCompetitionCorner(e.latlng.lat, e.latlng.lng)
        return
      }

      if (onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng)
      }
    },
    mousemove: (e) => {
      if (onMouseMove) {
        onMouseMove(e.latlng.lat, e.latlng.lng)
      }
    },
    mouseout: () => {
      if (onMouseOut) {
        onMouseOut()
      }
    }
  })
  return null
}

// Helper: Haversine-Distanz in Metern (einfache Version mit lat/lon)
function haversineDistanceSimple(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Helper: Haversine-Distanz in Metern
function haversineDistance(p1: TrajectoryPoint, p2: TrajectoryPoint): number {
  return haversineDistanceSimple(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
}

// Helper: Bearing von p1 nach p2
function pointBearing(p1: TrajectoryPoint, p2: TrajectoryPoint): number {
  const lat1 = p1.latitude * Math.PI / 180
  const lat2 = p2.latitude * Math.PI / 180
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// Trajectory Polyline mit erweitertem Tooltip (Geschwindigkeit, Hoehe, Richtung)
function TrajectoryPolyline({ trajectory }: { trajectory: ImportedTrajectory }) {
  const [hoverInfo, setHoverInfo] = useState<{
    altitude: number
    speed: number | null
    bearing: number | null
  } | null>(null)

  const positions = useMemo(() =>
    trajectory.points.map(p => [p.latitude, p.longitude] as [number, number]),
    [trajectory.points]
  )

  const handleMouseMove = useCallback((e: L.LeafletMouseEvent) => {
    const latlng = e.latlng
    const pts = trajectory.points
    if (pts.length === 0) return

    // Naechsten Punkt finden
    let minDist = Infinity
    let nearestIdx = 0
    for (let i = 0; i < pts.length; i++) {
      const dlat = pts[i].latitude - latlng.lat
      const dlon = pts[i].longitude - latlng.lng
      const d = dlat * dlat + dlon * dlon
      if (d < minDist) {
        minDist = d
        nearestIdx = i
      }
    }

    const pt = pts[nearestIdx]
    let speed: number | null = null
    let bearing: number | null = null

    // Geschwindigkeit + Richtung aus benachbarten Punkten berechnen
    if (pts.length >= 2) {
      const prevIdx = nearestIdx > 0 ? nearestIdx - 1 : 0
      const nextIdx = nearestIdx < pts.length - 1 ? nearestIdx + 1 : pts.length - 1

      if (prevIdx !== nextIdx) {
        const p1 = pts[prevIdx]
        const p2 = pts[nextIdx]

        // Richtung
        bearing = pointBearing(p1, p2)

        // Geschwindigkeit aus Distanz/Zeit (wenn Timestamps vorhanden)
        if (p1.timestamp && p2.timestamp) {
          const dist = haversineDistance(p1, p2)
          const dt = (new Date(p2.timestamp).getTime() - new Date(p1.timestamp).getTime()) / 1000
          if (dt > 0) {
            speed = (dist / dt) * 3.6 // m/s -> km/h
          }
        }
      }
    }

    setHoverInfo({ altitude: pt.altitude, speed, bearing })
  }, [trajectory.points])

  const handleMouseOut = useCallback(() => {
    setHoverInfo(null)
  }, [])

  const altFt = hoverInfo ? Math.round(hoverInfo.altitude * 3.28084) : 0

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: trajectory.color,
        weight: 3,
        opacity: 0.8
      }}
      eventHandlers={{
        mousemove: handleMouseMove,
        mouseout: handleMouseOut
      }}
    >
      <Tooltip sticky>
        <div style={{ fontSize: '12px', lineHeight: '1.5', fontWeight: 500 }}>
          <div style={{ fontWeight: 700, marginBottom: '2px' }}>{trajectory.name}</div>
          {hoverInfo ? (
            <>
              <div>Hoehe: {Math.round(hoverInfo.altitude)} m / {altFt} ft</div>
              {hoverInfo.bearing !== null && (
                <div>Richtung: {Math.round(hoverInfo.bearing)}°</div>
              )}
              {hoverInfo.speed !== null && (
                <div>Speed: {hoverInfo.speed.toFixed(1)} km/h</div>
              )}
            </>
          ) : (
            <div>{trajectory.altitudeLevel ? `${trajectory.altitudeLevel}m / ${Math.round(trajectory.altitudeLevel * 3.28084)}ft` : ''}</div>
          )}
        </div>
      </Tooltip>
    </Polyline>
  )
}

export function MapView({ onMapClick, clickedPosition, briefingOpen, drawingMode = 'none', onDrawingModeChange, gridSnapping = false, gridSize = 100, startPointTrigger, onOpenMaps, onOpenMarkerSettings }: MapViewProps) {
  const gpsData = useFlightStore(s => s.gpsData)
  const smoothedGpsData = useFlightStore(s => s.smoothedGpsData)
  const track = useFlightStore(s => s.track)
  const trackLine = useFlightStore(s => s.trackLine)
  const markers = useFlightStore(s => s.markers)
  const selectedGoal = useFlightStore(s => s.selectedGoal)
  const activeTask = useFlightStore(s => s.activeTask)
  const waypoints = useFlightStore(s => s.waypoints)
  const tasks = useFlightStore(s => s.tasks)
  const settings = useFlightStore(s => s.settings)
  const updateSettings = useFlightStore(s => s.updateSettings)
  const hdgCourseMode = useFlightStore(s => s.hdgCourseMode)
  const hdgPendingCourse = useFlightStore(s => s.hdgPendingCourse)
  const hdgPendingLineMode = useFlightStore(s => s.hdgPendingLineMode)
  const hdgCourseLines = useFlightStore(s => s.hdgCourseLines)
  const addHdgCourseLine = useFlightStore(s => s.addHdgCourseLine)
  const updateHdgCourseLine = useFlightStore(s => s.updateHdgCourseLine)
  const editingHdgCourseLineId = useFlightStore(s => s.editingHdgCourseLineId)
  const updateGoalPosition = useFlightStore(s => s.updateGoalPosition)
  const windLayers = useFlightStore(s => s.windLayers)
  const windSourceFilter = useFlightStore(s => s.windSourceFilter)
  const showWindRose = useFlightStore(s => s.showWindRose)
  const setShowWindRose = useFlightStore(s => s.setShowWindRose)
  const windLineMode = useFlightStore(s => s.windLineMode)
  const pendingWindLayer = useFlightStore(s => s.pendingWindLayer)
  const windLines = useFlightStore(s => s.windLines)
  const addWindLine = useFlightStore(s => s.addWindLine)
  const importedTrajectories = useFlightStore(s => s.importedTrajectories)
  const scoringAreas = useFlightStore(s => s.scoringAreas)
  const addScoringArea = useFlightStore(s => s.addScoringArea)
  const goalDragMode = useFlightStore(s => s.goalDragMode)
  const setMousePosition = useFlightStore(s => s.setMousePosition)
  const gpsSimulation = useFlightStore(s => s.gpsSimulation)
  const setGpsSimulationStartPosition = useFlightStore(s => s.setGpsSimulationStartPosition)
  const setGpsSimulationPickingStart = useFlightStore(s => s.setGpsSimulationPickingStart)
  const prohibitedZones = useFlightStore(s => s.prohibitedZones)
  const showProhibitedZones = useFlightStore(s => s.showProhibitedZones)
  const pzDrawMode = useFlightStore(s => s.pzDrawMode)
  const pzDrawPoints = useFlightStore(s => s.pzDrawPoints)
  const addPzDrawPoint = useFlightStore(s => s.addPzDrawPoint)
  const windImportPickPosition = useFlightStore(s => s.windImportPickPosition)
  const setWindImportPosition = useFlightStore(s => s.setWindImportPosition)
  const isRecording = useFlightStore(s => s.isRecording)
  const flyToPosition = useFlightStore(s => s.flyToPosition)
  const setFlyToPosition = useFlightStore(s => s.setFlyToPosition)

  // Team-Daten
  const teamSession = useTeamStore(s => s.session)
  const teamMembers = useTeamStore(s => s.members)
  const myTeamMemberId = useTeamStore(s => s.myMemberId)
  const hiddenTeamMembers = useTeamStore(s => s.hiddenMembers)

  const [followBalloon, setFollowBalloon] = useState(true)
  const [mapType, setMapType] = useState<'osm' | 'satellite' | 'hybrid'>('osm')
  const [showPowerLines, setShowPowerLines] = useState(false) // Hochspannungsleitungen Overlay
  const [showPowerLinesLegend, setShowPowerLinesLegend] = useState(false) // Legende für Power Lines
  const [showCompetitionArea, setShowCompetitionArea] = useState(false) // Wettkampfbereich-Panel
  const [showWindsPanel, setShowWindsPanel] = useState(false)
  const [showMarkerSettings, setShowMarkerSettings] = useState(false)
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null)


  // Ref um zu tracken wann zuletzt gezeichnet wurde (um Doppelklicks danach zu ermöglichen)
  const lastDrawTimeRef = useRef<number>(0)

  // Verwende geglättete GPS-Daten für Kartenanzeige, rohe für Berechnungen
  const displayGpsData = smoothedGpsData || gpsData
  // Hole den aktuellen Task aus dem Store (damit Updates reflektiert werden)
  const viewingTask = viewingTaskId ? tasks.find(t => t.id === viewingTaskId) || null : null

  // activeMaps und savedCompetitionMaps aus dem Store
  const activeMaps = useFlightStore(s => s.activeMaps)
  const toggleActiveMap = useFlightStore(s => s.toggleActiveMap)
  const savedCompetitionMaps = useFlightStore(s => s.savedCompetitionMaps)

  // Landeprognose
  const landingPrediction = useFlightStore(s => s.landingPrediction)
  const showLandingPrediction = useFlightStore(s => s.showLandingPrediction)
  const dropCalculator = useFlightStore(s => s.dropCalculator)
  const climbPointResult = useFlightStore(s => s.climbPointResult)
  const landRunResult = useFlightStore(s => s.landRunResult)
  const angleResult = useFlightStore(s => s.angleResult)

  // Aktive Competition Map aus dem Store - nur eine kann aktiv sein
  const activeCompetitionMapFromStore = activeMaps.length > 0
    ? savedCompetitionMaps.find(m => m.id === activeMaps[0])
    : null

  const [mapLayers, setMapLayers] = useState<ActiveMapLayer[]>([])
  const [reprojectionProgress, setReprojectionProgress] = useState<{ mapName: string; message: string; percent: number } | null>(null)
  const [editMode, setEditMode] = useState(false) // Edit-Modus für Goal-Verschiebung
  const [moveStepSize, setMoveStepSize] = useState<MoveStepSize>(100) // Schrittgröße für Pfeiltasten
  const [selectedWindLayer, setSelectedWindLayer] = useState<number | null>(null) // Ausgewählte Windschicht zum Anzeigen

  // Stoppuhr und Messwerkzeug
  const [showStopwatch, setShowStopwatch] = useState(false)
  const [showMeasureTool, setShowMeasureTool] = useState(false)
  const [measureMode, setMeasureMode] = useState<MeasureMode>('distance')
  const [measureAreaCompleted, setMeasureAreaCompleted] = useState(false)
  const [isOutsideCompetitionArea, setIsOutsideCompetitionArea] = useState(false)

  // Hover-Popup für Drop-Marker
  const [hoveredDropMarker, setHoveredDropMarker] = useState<string | null>(null)
  const [dropMarkerHoverPos, setDropMarkerHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [hoveredMarkerScreenPos, setHoveredMarkerScreenPos] = useState<{ x: number; y: number } | null>(null)

  // UTM-Ansicht State entfernt - nicht mehr benötigt
  const hasUtmReprojection = !!activeCompetitionMapFromStore?.utmReprojection

  // Leaflet Map Referenz für Overlay-Kalibrierung
  const [leafletMapRef, setLeafletMapRef] = useState<L.Map | null>(null)
  const [measurePoints, setMeasurePoints] = useState<{ lat: number; lon: number }[]>([])

  // Cache für transformierte PZ-Koordinaten (WGS84 → Display-Koordinaten wenn OZI-Karte aktiv)
  // Key: `${mapId}:${pzId}` oder `${mapId}:polygon:${pzId}:${pointIndex}`
  const [displayCoordsCache, setDisplayCoordsCache] = useState<Map<string, { lat: number; lon: number }>>(new Map())

  // Aktive OZI-Karte ID (für PZ-Transformation) - jetzt aus activeMaps
  const activeOziMapId = activeMaps.length > 0 ? activeMaps[0] : null

  // Transformiere PZ-Koordinaten für Display wenn OZI-Karte aktiv ist
  useEffect(() => {
    if (!activeOziMapId || prohibitedZones.length === 0) {
      setDisplayCoordsCache(new Map())
      return
    }

    const mapsAPI = getMapsAPI()
    // Prüfe ob geoToDisplayCoord verfügbar ist (nur in Electron)
    const geoToDisplayCoord = 'geoToDisplayCoord' in mapsAPI
      ? (mapsAPI as { geoToDisplayCoord: (mapId: string, lat: number, lon: number) => Promise<{ lat: number; lon: number } | null> }).geoToDisplayCoord
      : null

    if (!geoToDisplayCoord) {
      setDisplayCoordsCache(new Map())
      return
    }

    const transformCoords = async () => {
      const newCache = new Map<string, { lat: number; lon: number }>()

      for (const pz of prohibitedZones) {
        // Hauptpunkt transformieren
        const displayCoord = await geoToDisplayCoord(activeOziMapId, pz.lat, pz.lon)
        if (displayCoord) {
          newCache.set(`${activeOziMapId}:${pz.id}`, displayCoord)
        }

        // Polygon-Punkte transformieren wenn vorhanden
        if (pz.polygon && pz.polygon.length > 0) {
          for (let i = 0; i < pz.polygon.length; i++) {
            const p = pz.polygon[i]
            const polyDisplayCoord = await geoToDisplayCoord(activeOziMapId, p.lat, p.lon)
            if (polyDisplayCoord) {
              newCache.set(`${activeOziMapId}:polygon:${pz.id}:${i}`, polyDisplayCoord)
            }
          }
        }
      }

      setDisplayCoordsCache(newCache)
    }

    transformCoords()
  }, [activeOziMapId, prohibitedZones])

  // Hilfsfunktion: Hole Display-Koordinaten für PZ (transformiert wenn OZI-Karte aktiv, sonst Original)
  const getPzDisplayCoord = useCallback((pzId: string, lat: number, lon: number): { lat: number; lon: number } => {
    if (activeOziMapId) {
      const cached = displayCoordsCache.get(`${activeOziMapId}:${pzId}`)
      if (cached) return cached
    }
    return { lat, lon }
  }, [activeOziMapId, displayCoordsCache])

  // Hilfsfunktion: Hole Display-Koordinaten für Polygon-Punkt
  const getPzPolygonDisplayCoords = useCallback((pzId: string, polygon: Array<{ lat: number; lon: number }>): Array<{ lat: number; lon: number }> => {
    if (activeOziMapId) {
      return polygon.map((p, i) => {
        const cached = displayCoordsCache.get(`${activeOziMapId}:polygon:${pzId}:${i}`)
        return cached || p
      })
    }
    return polygon
  }, [activeOziMapId, displayCoordsCache])

  // Prüfe ob Viewport außerhalb der Competition Area ist
  useEffect(() => {
    if (!leafletMapRef || !activeCompetitionMapFromStore?.bounds) {
      setIsOutsideCompetitionArea(false)
      return
    }

    const bounds = activeCompetitionMapFromStore.bounds
    const competitionBounds = L.latLngBounds(
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    )

    const checkIfOutside = () => {
      const mapBounds = leafletMapRef.getBounds()
      // Prüfe ob die aktuelle Ansicht die Competition Area NICHT überschneidet
      const isOutside = !mapBounds.intersects(competitionBounds)
      setIsOutsideCompetitionArea(isOutside)
    }

    // Initial prüfen
    checkIfOutside()

    // Bei Kartenbewegung prüfen
    leafletMapRef.on('moveend', checkIfOutside)

    return () => {
      leafletMapRef.off('moveend', checkIfOutside)
    }
  }, [leafletMapRef, activeCompetitionMapFromStore?.bounds])

  // Funktion um zur Competition Area zurückzukehren
  const flyToCompetitionArea = useCallback(() => {
    if (!leafletMapRef || !activeCompetitionMapFromStore?.bounds) return

    const bounds = activeCompetitionMapFromStore.bounds
    const latLngBounds = L.latLngBounds(
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    )
    leafletMapRef.flyToBounds(latLngBounds, { padding: [20, 20], maxZoom: 14 })
  }, [leafletMapRef, activeCompetitionMapFromStore?.bounds])

  // Fly-To Position Effect - reagiert auf Store-Änderungen
  useEffect(() => {
    if (flyToPosition && leafletMapRef) {
      setFollowBalloon(false) // Ballon-Verfolgung deaktivieren
      leafletMapRef.flyTo(
        [flyToPosition.lat, flyToPosition.lon],
        flyToPosition.zoom || 17,
        { duration: 1 }
      )
      setFlyToPosition(null) // Position zurücksetzen
    }
  }, [flyToPosition, leafletMapRef, setFlyToPosition])

  // Drawing State
  const [drawingPoints, setDrawingPoints] = useState<{ lat: number; lon: number }[]>([])
  const [drawingCenter, setDrawingCenter] = useState<{ lat: number; lon: number } | null>(null)
  const [drawingRadius, setDrawingRadius] = useState(500) // Default radius in meters

  // Start-Punkt Trigger - Füge Punkt bei eingegebenen Koordinaten hinzu
  useEffect(() => {
    if (startPointTrigger) {
      if (drawingMode === 'freehand') {
        const snapped = snapToGrid(startPointTrigger.lat, startPointTrigger.lon, true)
        setDrawingPoints([{ lat: snapped.lat, lon: snapped.lon }])
      } else if (drawingMode === 'circle') {
        // Erstelle Kreis mit eingegebenem Radius am Mittelpunkt
        const radius = settings.circleRadius || 500
        addScoringArea({
          type: 'circle',
          center: {
            latitude: startPointTrigger.lat,
            longitude: startPointTrigger.lon,
            altitude: 0,
            timestamp: new Date()
          },
          radius: radius,
          color: settings.drawingLineColor || '#3b82f6',
          fillColor: settings.drawingFillColor || '#3b82f6',
          visible: true,
          name: `Circle ${scoringAreas.length + 1}`
        })
        onDrawingModeChange?.('none')
      }
    }
  }, [startPointTrigger])

  // Karten-Layer laden wenn aktiviert - EINFACHE VERSION
  const handleToggleMap = async (mapId: string, active: boolean) => {
    const mapsAPI = getMapsAPI()
    if (active) {
      try {
        const maps = await mapsAPI.list()
        const mapInfo = maps.find((m: any) => m.id === mapId)

        if (!mapInfo) {
          console.error('Karte nicht gefunden:', mapId)
          return
        }

        const tileInfo = await mapsAPI.getTileInfo(mapId)
        if (!tileInfo) {
          alert(`Karte "${mapInfo.name}" konnte nicht geladen werden.`)
          return
        }

        const imageUrl = tileInfo.imageUrl || `${tileInfo.tileUrl.split('/tile/')[0]}/image/${mapId}`

        const bounds: L.LatLngBoundsExpression = [
          [mapInfo.bounds.south, mapInfo.bounds.west],
          [mapInfo.bounds.north, mapInfo.bounds.east]
        ]

        console.log('Karte aktiviert:', mapInfo.name)

        setMapLayers(prev => [...prev, {
          id: mapId,
          name: mapInfo.name,
          imagePath: imageUrl,
          bounds,
          opacity: 1.0
        }])
        toggleActiveMap(mapId, true)
      } catch (err: any) {
        console.error('Fehler beim Laden der Karte:', err)
        alert(`Fehler beim Laden der Karte:\n\n${String(err?.message || err || '')}`)
      }
    } else {
      setMapLayers(prev => prev.filter(m => m.id !== mapId))
      toggleActiveMap(mapId, false)
    }
  }


  // Automatische UTM-Zone Aktualisierung bei GPS-Verbindung
  const lastAutoUtmZoneRef = useRef<number | null>(null)
  useEffect(() => {
    if (gpsData && gpsData.longitude) {
      // Berechne UTM Zone aus GPS-Position
      const calculatedZone = Math.floor((gpsData.longitude + 180) / 6) + 1

      // Nur aktualisieren wenn Zone sich geändert hat und noch nicht automatisch gesetzt wurde
      if (calculatedZone >= 1 && calculatedZone <= 60 && calculatedZone !== lastAutoUtmZoneRef.current) {
        // Nur aktualisieren wenn keine Competition Map aktiv ist (die hat eigene UTM Zone)
        if (!activeCompetitionMapFromStore?.utmZone) {
          console.log(`[MapView] GPS UTM Zone automatisch aktualisiert: ${settings.utmZone} -> ${calculatedZone}`)
          updateSettings({ utmZone: calculatedZone })
          lastAutoUtmZoneRef.current = calculatedZone
        }
      }
    }
  }, [gpsData?.longitude, activeCompetitionMapFromStore?.utmZone])

  // Grid Snapping Funktion - snappt auf das nächste Grid-Kreuz
  const snapToGrid = (lat: number, lon: number, isFirstPoint: boolean = false): { lat: number; lon: number } => {
    // Verwende gridSize aus Settings
    const effectiveGridSize = settings.gridSize || gridSize || 100

    if (!effectiveGridSize) {
      return { lat, lon }
    }

    // Verwende die gleiche UTM-Zone wie das Grid Overlay
    // Berechne Zone aus der Klick-Position für konsistente Ergebnisse
    const calculatedZone = Math.floor((lon + 180) / 6) + 1
    const utmZone = activeCompetitionMapFromStore?.utmZone || (settings.utmZone >= 1 && settings.utmZone <= 60 ? settings.utmZone : calculatedZone)

    // Konvertiere Klick-Position zu UTM mit der erzwungenen Zone
    const utm = latLonToUTM(lat, lon, utmZone)
    const hemisphere: 'N' | 'S' = lat >= 0 ? 'N' : 'S'

    // Einfaches Grid-Snapping - snappe auf das nächste Vielfache von gridSize
    // Dies entspricht genau der Berechnung im GridOverlay
    const snappedEasting = Math.round(utm.easting / effectiveGridSize) * effectiveGridSize
    const snappedNorthing = Math.round(utm.northing / effectiveGridSize) * effectiveGridSize

    // Konvertiere zurück zu Lat/Lon mit der gleichen Zone
    const snapped = utmToLatLon({
      zone: utmZone,
      hemisphere: hemisphere,
      easting: snappedEasting,
      northing: snappedNorthing
    })

    return { lat: snapped.lat, lon: snapped.lon }
  }

  // Zeichen-Klick Handler
  const handleDrawClick = (lat: number, lon: number) => {
    if (!drawingMode || drawingMode === 'none') return

    // Ignoriere Klicks direkt nach dem Zeichnen (500ms Cooldown)
    if (Date.now() - lastDrawTimeRef.current < 500) return

    // Bestimme ob dies der erste Punkt ist
    const isFirstPoint = drawingMode === 'circle' ? !drawingCenter :
                         drawingMode === 'freehand' ? drawingPoints.length === 0 :
                         drawingMode === 'line' ? drawingPoints.length === 0 : false

    // Apply grid snapping - bei Freehand-Modus (wenn aktiviert), Circle-Modus (wenn aktiviert) und Line-Modus (wenn aktiviert)
    if (drawingMode === 'freehand' && gridSnapping) {
      const snapped = snapToGrid(lat, lon, isFirstPoint)
      lat = snapped.lat
      lon = snapped.lon
    } else if (drawingMode === 'circle' && settings.circleGridSnapping) {
      const snapped = snapToGrid(lat, lon, true)  // true = snap direkt auf Grid-Punkt
      lat = snapped.lat
      lon = snapped.lon
    } else if (drawingMode === 'line' && settings.lineGridSnapping) {
      const snapped = snapToGrid(lat, lon, isFirstPoint)
      lat = snapped.lat
      lon = snapped.lon
    }

    switch (drawingMode) {
      case 'circle':
        // Einzelklick: Erstelle Kreis mit eingegebenem Radius
        const radius = settings.circleRadius || 500
        addScoringArea({
          type: 'circle',
          center: {
            latitude: lat,
            longitude: lon,
            altitude: 0,
            timestamp: new Date()
          },
          radius: radius,
          color: settings.drawingLineColor || '#3b82f6',
          fillColor: settings.drawingFillColor || '#3b82f6',
          visible: true,
          name: `Circle ${scoringAreas.length + 1}`
        })
        lastDrawTimeRef.current = Date.now()
        onDrawingModeChange?.('none')
        break

      case 'line':
        // Bei Linie: Sammle genau 2 Punkte
        setDrawingPoints(prev => {
          const newPoints = [...prev, { lat, lon }]
          // Wenn 2 Punkte erreicht, erstelle Linie
          if (newPoints.length === 2) {
            addScoringArea({
              type: 'polygon',
              points: newPoints.map(p => ({
                latitude: p.lat,
                longitude: p.lon,
                altitude: 0,
                timestamp: new Date()
              })),
              color: settings.drawingLineColor || '#3b82f6',
              fillColor: 'transparent',
              visible: true,
              name: `Line ${scoringAreas.length + 1}`
            })
            lastDrawTimeRef.current = Date.now()
            onDrawingModeChange?.('none')
            return []
          }
          return newPoints
        })
        break

      case 'freehand':
        // Bei Freehand: Sammle Punkte bei jedem Klick (mit Grid Snapping)
        setDrawingPoints(prev => [...prev, { lat, lon }])
        break
    }
  }

  // Polygon abschließen
  const finishPolygon = () => {
    if (drawingPoints.length >= 3) {
      addScoringArea({
        type: 'polygon',
        points: drawingPoints.map(p => ({
          latitude: p.lat,
          longitude: p.lon,
          altitude: 0,
          timestamp: new Date()
        })),
        color: settings.drawingLineColor || '#3b82f6',
        fillColor: settings.drawingFillColor || '#3b82f6',
        visible: true,
        name: `Polygon ${scoringAreas.length + 1}`
      })
    }
    setDrawingPoints([])
    lastDrawTimeRef.current = Date.now()
    onDrawingModeChange?.('none')
  }

  // Zeichnung abbrechen
  const cancelDrawing = () => {
    setDrawingCenter(null)
    setDrawingPoints([])
    onDrawingModeChange?.('none')
  }

  // Berechne rechten Margin basierend auf offenen Panels
  const rightMargin = briefingOpen ? 320 : 0

  // Default Position (Österreich Mitte)
  const defaultPosition: [number, number] = [47.5, 13.5]
  const position: [number, number] = gpsData
    ? [gpsData.latitude, gpsData.longitude]
    : defaultPosition

  // Geglättete Position für flüssige Kartenanzeige des Ballons
  const balloonPosition: [number, number] = displayGpsData
    ? [displayGpsData.latitude, displayGpsData.longitude]
    : defaultPosition

  // Track Linie - trackLine enthält jeden GPS-Punkt (durchgehend), track nur die Intervall-Punkte
  const trackPoints: [number, number][] = track.map(t => [
    t.position.latitude,
    t.position.longitude
  ])
  // Für die Polyline: trackLine (durchgehend) verwenden wenn vorhanden, sonst trackPoints
  const linePositions: [number, number][] = trackLine.length > 1 ? trackLine : trackPoints

  // Alle Goals aus allen Tasks sammeln (für Briefing Ansicht)
  const allGoals = tasks.flatMap(t => t.goals)

  return (
    <div
      className="map-container"
      style={{ marginRight: rightMargin, transition: 'margin 0.3s' }}
      onMouseMove={(e) => {
        // Schließe das Hover-Popup wenn die Maus zu weit vom Marker entfernt ist
        if (hoveredMarkerScreenPos && hoveredDropMarker) {
          const rect = e.currentTarget.getBoundingClientRect()
          const mouseX = e.clientX - rect.left
          const mouseY = e.clientY - rect.top
          const distance = Math.sqrt(
            Math.pow(mouseX - hoveredMarkerScreenPos.x, 2) +
            Math.pow(mouseY - hoveredMarkerScreenPos.y, 2)
          )
          // Wenn Maus mehr als 40px vom Marker entfernt ist, Popup schließen
          if (distance > 40) {
            setHoveredDropMarker(null)
            setDropMarkerHoverPos(null)
            setHoveredMarkerScreenPos(null)
          }
        }
      }}
    >
      {/* Reprojektion Ladebalken */}
      {reprojectionProgress && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            backgroundColor: '#1f2937',
            borderRadius: '12px',
            padding: '24px 32px',
            minWidth: '350px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{ color: '#f3f4f6', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
              Karte wird vorbereitet...
            </div>
            <div style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
              {reprojectionProgress.mapName}
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#374151',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${reprojectionProgress.percent}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                borderRadius: '4px',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '8px' }}>
              {reprojectionProgress.message} ({reprojectionProgress.percent}%)
            </div>
          </div>
        </div>
      )}

      {/* UTM-Ansicht entfernt - Grid wird direkt über Competition Map angezeigt */}

      {/* Standard Leaflet MapContainer - OZI-Karten werden reprojiziert geladen */}
      <MapContainer
          center={position}
          zoom={14}
          minZoom={3}
          maxZoom={20}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
          preferCanvas={true}
          renderer={L.canvas()}
          // Performance Optimierungen für flüssiges Panning
          inertia={true}
          inertiaDeceleration={2000}
          inertiaMaxSpeed={1500}
          easeLinearity={0.25}
          worldCopyJump={false}
          maxBoundsViscosity={0}
          // Zoom Animation für smootheres Zoomen
          zoomAnimation={true}
          zoomAnimationThreshold={4}
          fadeAnimation={true}
          markerZoomAnimation={true}
          // Doppelklick-Zoom aktiviert (ScoringAreas sind jetzt unter Markern, also kein Konflikt)
          doubleClickZoom={true}
        >
          {/* Base Map Tiles - immer anzeigen, Bounds von aktiver Competition Map verwenden */}
          {/* maxNativeZoom: nie höher als der Provider nativ liefert (OSM=19, Topo=17, Google=20) */}
          {/* downloadedZoomRange/bounds nur setzen wenn der angezeigte Provider zum Download-Provider passt */}
          {mapType === 'osm' && (
          <CachedTileLayer
            provider="openstreetmap"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={20}
            maxNativeZoom={activeCompetitionMapFromStore ? Math.min(activeCompetitionMapFromStore.maxZoom, 19) : 19}
            subdomains={['a', 'b', 'c']}
            bounds={activeCompetitionMapFromStore?.bounds || null}
            downloadedZoomRange={activeCompetitionMapFromStore?.provider === 'openstreetmap' ? { min: activeCompetitionMapFromStore.minZoom, max: activeCompetitionMapFromStore.maxZoom } : null}
          />
        )}
        {mapType === 'satellite' && (
          <CachedTileLayer
            provider="opentopomap"
            attribution='&copy; <a href="https://www.opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            subdomains={['a', 'b', 'c']}
            maxZoom={20}
            maxNativeZoom={activeCompetitionMapFromStore ? Math.min(activeCompetitionMapFromStore.maxZoom, 17) : 17}
            bounds={activeCompetitionMapFromStore?.bounds || null}
            downloadedZoomRange={activeCompetitionMapFromStore?.provider === 'opentopomap' ? { min: activeCompetitionMapFromStore.minZoom, max: activeCompetitionMapFromStore.maxZoom } : null}
          />
        )}
        {mapType === 'hybrid' && (
          <CachedTileLayer
            provider="google-satellite"
            attribution='&copy; Google'
            url="https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            maxZoom={20}
            maxNativeZoom={activeCompetitionMapFromStore ? Math.min(activeCompetitionMapFromStore.maxZoom, 20) : 20}
            subdomains={['0', '1', '2', '3']}
            bounds={activeCompetitionMapFromStore?.bounds || null}
            downloadedZoomRange={null}
          />
        )}

        {/* Power Lines Overlay - für alle Kartentypen */}
        <PowerLinesLayer visible={showPowerLines} />

        {/* Map Ref Setter - capture map reference */}
        <MapRefSetter onMapReady={setLeafletMapRef} />

        {/* Competition Map Bounds Controller - begrenzt Karte auf heruntergeladenen Bereich */}
        <CompetitionMapBoundsController bounds={activeCompetitionMapFromStore?.bounds || null} />

        {/* Klick Handler */}
        <MapClickHandler
          onMapClick={onMapClick}
          hdgCourseMode={hdgCourseMode}
          hdgPendingCourse={hdgPendingCourse}
          hdgPendingLineMode={hdgPendingLineMode}
          onSetHdgCourseLine={addHdgCourseLine}
          editingHdgCourseLineId={editingHdgCourseLineId}
          onUpdateHdgCourseLine={updateHdgCourseLine}
          tasksForSnap={tasks}
          waypointsForSnap={waypoints}
          windLineMode={windLineMode}
          pendingWindLayer={pendingWindLayer}
          onSetWindLine={addWindLine}
          drawingMode={drawingMode}
          onDrawClick={handleDrawClick}
          measureMode={showMeasureTool && !measureAreaCompleted}
          onMeasureClick={(lat, lon) => {
            // Snapping zu Goals/Waypoints (5m Radius)
            const SNAP_RADIUS = 5 // Meter
            let snapLat = lat
            let snapLon = lon
            let closestDist = SNAP_RADIUS

            // Alle Goals aus Tasks sammeln
            const allGoalsForSnap = tasks.flatMap(t => t.goals)

            // Prüfe ob ein Goal in der Nähe ist (finde das nächste)
            for (const goal of allGoalsForSnap) {
              if (goal.position?.latitude && goal.position?.longitude) {
                const dist = haversineDistance(
                  { latitude: lat, longitude: lon } as any,
                  { latitude: goal.position.latitude, longitude: goal.position.longitude } as any
                )
                if (dist < closestDist) {
                  closestDist = dist
                  snapLat = goal.position.latitude
                  snapLon = goal.position.longitude
                }
              }
            }

            // Prüfe Waypoints (finde das nächste)
            for (const wp of waypoints) {
              if (wp.position?.latitude && wp.position?.longitude) {
                const dist = haversineDistance(
                  { latitude: lat, longitude: lon } as any,
                  { latitude: wp.position.latitude, longitude: wp.position.longitude } as any
                )
                if (dist < closestDist) {
                  closestDist = dist
                  snapLat = wp.position.latitude
                  snapLon = wp.position.longitude
                }
              }
            }

            setMeasurePoints(prev => [...prev, { lat: snapLat, lon: snapLon }])
          }}
          onMouseMove={(lat, lon) => setMousePosition({ lat, lon })}
          onMouseOut={() => setMousePosition(null)}
          gpsSimPickingStart={gpsSimulation.pickingStartPoint}
          onGpsSimStartPicked={(lat, lon) => {
            setGpsSimulationStartPosition({ lat, lon })
            setGpsSimulationPickingStart(false)
          }}
          onDragStart={() => setFollowBalloon(false)}
          pzDrawMode={pzDrawMode}
          onPzDrawClick={(lat, lon) => addPzDrawPoint({ lat, lon })}
          windImportPickPosition={windImportPickPosition}
          onWindImportPositionPicked={(lat, lon) => setWindImportPosition({ lat, lon })}
        />

        {/* Karte zentrieren */}
        <MapCenterUpdater followBalloon={followBalloon} />

        {/* Mess-Linien und Punkte */}
        {measureMode === 'distance' && measurePoints.length >= 2 && (
          <Polyline
            positions={measurePoints.map(p => [p.lat, p.lon] as [number, number])}
            pathOptions={{
              color: settings.measureColor || '#22c55e',
              weight: 3,
              opacity: 0.9,
              dashArray: '10, 5'
            }}
          />
        )}
        {/* Flächen-Modus: Polygon mit Füllung */}
        {measureMode === 'area' && measurePoints.length >= 2 && (
          <Polygon
            positions={measurePoints.map(p => [p.lat, p.lon] as [number, number])}
            pathOptions={{
              color: settings.measureColor || '#22c55e',
              weight: 3,
              opacity: 0.9,
              fillColor: settings.measureColor || '#22c55e',
              fillOpacity: measureAreaCompleted ? 0.25 : 0.1,
              dashArray: measureAreaCompleted ? undefined : '10, 5'
            }}
          />
        )}
        {measurePoints.map((point, index) => (
          <CircleMarker
            key={`measure-${index}`}
            center={[point.lat, point.lon]}
            radius={5}
            pathOptions={{
              color: settings.measureColor || '#22c55e',
              fillColor: settings.measureColor || '#22c55e',
              fillOpacity: 1,
              weight: 2
            }}
          />
        ))}

        {/* Keyboard Navigation für ausgewähltes Goal (nur im Edit-Modus) */}
        <KeyboardNavigation
          editingGoal={null}
          onMoveGoal={updateGoalPosition}
          editMode={editMode}
          moveStepSize={moveStepSize}
        />

        {/* HDG Kurs-Linien (bis zu 3) */}
        {hdgCourseLines.map((courseLine, lineIndex) => {
          // Berechne Endpunkt der Linie (einstellbare Länge in Kursrichtung)
          const lineLength = settings.hdgCourseLineLength || 10000 // Default 10km in Metern
          const courseRad = (courseLine.course * Math.PI) / 180
          const centerLat = courseLine.startPosition.lat
          const centerLon = courseLine.startPosition.lon
          const lineMode = courseLine.lineMode || 'from'

          // Berechnung des Endpunkts (vereinfacht, gute Näherung für kurze Distanzen)
          const earthRadius = 6371000 // Meter
          const latDiff = (lineLength * Math.cos(courseRad)) / earthRadius * (180 / Math.PI)
          const lonDiff = (lineLength * Math.sin(courseRad)) / (earthRadius * Math.cos(centerLat * Math.PI / 180)) * (180 / Math.PI)

          // Berechne Start- und Endpunkte basierend auf lineMode
          let startLat: number, startLon: number, endLat: number, endLon: number

          if (lineMode === 'from') {
            // Linie geht VON Startpunkt in Kursrichtung
            startLat = centerLat
            startLon = centerLon
            endLat = centerLat + latDiff
            endLon = centerLon + lonDiff
          } else if (lineMode === 'to') {
            // Linie kommt ZUM Startpunkt aus der entgegengesetzten Richtung
            startLat = centerLat - latDiff
            startLon = centerLon - lonDiff
            endLat = centerLat
            endLon = centerLon
          } else {
            // extended: Linie geht in beide Richtungen
            startLat = centerLat - latDiff
            startLon = centerLon - lonDiff
            endLat = centerLat + latDiff
            endLon = centerLon + lonDiff
          }

          // Verwende Settings für Breite und Farbe der Linie (aus Settings basierend auf Index)
          const defaultColors = ['#f59e0b', '#3b82f6', '#22c55e']
          const settingsColors = settings.hdgCourseLineColors || defaultColors
          const lineColor = settingsColors[lineIndex] || settingsColors[0]  // Farbe aus Settings basierend auf Linien-Index
          const lineWidth = settings.hdgCourseLineWidth || 3
          const borderWidth = lineWidth + 3

          // Berechne Mittelpunkt für Kurs-Anzeige
          const midLat = (startLat + endLat) / 2
          const midLon = (startLon + endLon) / 2

          return (
            <React.Fragment key={courseLine.id}>
              {/* Schwarzer Rand für Kontrast */}
              <Polyline
                positions={[
                  [startLat, startLon],
                  [endLat, endLon]
                ]}
                pathOptions={{
                  color: '#000000',
                  weight: borderWidth,
                  opacity: 0.5
                }}
                interactive={false}
              />
              {/* Hauptlinie in Linienfarbe */}
              <Polyline
                positions={[
                  [startLat, startLon],
                  [endLat, endLon]
                ]}
                pathOptions={{
                  color: lineColor,
                  weight: lineWidth,
                  opacity: 1,
                  dashArray: '10, 5'
                }}
                interactive={false}
              />
              {/* Startpunkt Marker (Klick-Position) */}
              <Marker
                position={[centerLat, centerLon]}
                icon={L.divIcon({
                  className: 'hdg-course-start',
                  html: `
                    <div style="
                      width: 16px;
                      height: 16px;
                      background: ${lineColor};
                      border: 3px solid white;
                      border-radius: 50%;
                      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                      transform: translate(-50%, -50%);
                    "></div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
              {/* Kurs-Anzeige in der Mitte der Linie */}
              <Marker
                position={[midLat, midLon]}
                icon={L.divIcon({
                  className: 'hdg-course-label',
                  html: `
                    <div style="
                      display: inline-block;
                      background: ${settings.courseDisplayBgColor || lineColor};
                      color: ${settings.courseDisplayTextColor || '#ffffff'};
                      padding: 3px 7px;
                      border-radius: 4px;
                      font-size: ${settings.courseDisplaySize || 11}px;
                      font-weight: ${settings.courseDisplayBold !== false ? 700 : 400};
                      white-space: nowrap;
                      transform: translate(-50%, -50%);
                      border: 2px solid #000;
                      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    ">
                      ${courseLine.course.toFixed(0).padStart(3, '0')}°
                    </div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
            </React.Fragment>
          )
        })}

        {/* Wind-Linien (bis zu 3) */}
        {windLines.map((windLine, index) => {
          // Berechne Endpunkt der Linie (10km in Windrichtung)
          const lineLength = 10000 // 10km in Metern
          const startLat = windLine.startPosition.lat
          const startLon = windLine.startPosition.lon

          // direction = woher der Wind kommt (intern immer "VON")
          // Linie zeigt immer in Flugrichtung (wohin der Ballon fliegt = direction + 180)
          const flyDirection = (windLine.windLayer.direction + 180) % 360
          const flyDirectionRad = (flyDirection * Math.PI) / 180

          // Berechnung des Endpunkts
          const earthRadius = 6371000 // Meter
          const latDiff = (lineLength * Math.cos(flyDirectionRad)) / earthRadius * (180 / Math.PI)
          const lonDiff = (lineLength * Math.sin(flyDirectionRad)) / (earthRadius * Math.cos(startLat * Math.PI / 180)) * (180 / Math.PI)

          const endLat = startLat + latDiff
          const endLon = startLon + lonDiff

          // Formatiere Windrichtung
          const formatWindDirection = () => {
            if (settings.windDirectionMode === 'from') {
              return windLine.windLayer.direction.toString().padStart(3, '0')
            } else {
              const toDirection = (windLine.windLayer.direction + 180) % 360
              return toDirection.toString().padStart(3, '0')
            }
          }

          // Formatiere Höhe basierend auf Einheit
          const formatAltitudeForLabel = () => {
            const altM = windLine.windLayer.altitude
            if (settings.altitudeUnit === 'feet') {
              return `${Math.round(altM * 3.28084)}ft`
            }
            return `${Math.round(altM)}m`
          }

          // Verwende individuelle Farbe aus Settings basierend auf Index
          const defaultColors = ['#00bcd4', '#ff6b6b', '#ffd93d']
          const configuredColors = settings.windLineColors || defaultColors as [string, string, string]
          const windLineColor = configuredColors[index] || defaultColors[index] || '#00bcd4'
          const windLineWidth = settings.windLineWidth || 3
          const borderWidth = windLineWidth + 3

          return (
            <React.Fragment key={windLine.id}>
              {/* Schwarzer Rand für Kontrast */}
              <Polyline
                positions={[
                  [startLat, startLon],
                  [endLat, endLon]
                ]}
                pathOptions={{
                  color: '#000000',
                  weight: borderWidth,
                  opacity: 0.5
                }}
              />
              {/* Hauptlinie in Linienfarbe */}
              <Polyline
                positions={[
                  [startLat, startLon],
                  [endLat, endLon]
                ]}
                pathOptions={{
                  color: windLineColor,
                  weight: windLineWidth,
                  opacity: 1
                }}
              />
              {/* Pfeilspitze am Ende */}
              <Marker
                position={[endLat, endLon]}
                icon={L.divIcon({
                  className: 'wind-line-arrow-head',
                  html: `
                    <div style="
                      width: 0;
                      height: 0;
                      border-left: 10px solid transparent;
                      border-right: 10px solid transparent;
                      border-bottom: 16px solid ${windLineColor};
                      transform: translate(-50%, -50%) rotate(${flyDirection}deg);
                      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                    "></div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
              {/* Startpunkt Marker */}
              <Marker
                position={[startLat, startLon]}
                icon={L.divIcon({
                  className: 'wind-line-start',
                  html: `
                    <div style="
                      position: relative;
                      width: 16px;
                      height: 16px;
                      transform: translate(-50%, -50%);
                    ">
                      <div style="
                        width: 16px;
                        height: 16px;
                        background: ${windLineColor};
                        border: 3px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                      "></div>
                      <div style="
                        position: absolute;
                        top: 20px;
                        left: 50%;
                        transform: translateX(-50%);
                        background: ${windLineColor};
                        color: white;
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 700;
                        white-space: nowrap;
                      ">
                        ${formatAltitudeForLabel()} - ${formatWindDirection()}° / ${windLine.windLayer.speed.toFixed(1)} km/h
                      </div>
                    </div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
            </React.Fragment>
          )
        })}

        {/* Ausgewählte Windschicht anzeigen */}
        {selectedWindLayer !== null && displayGpsData && (() => {
          const windLayer = windLayers.find(w => w.altitude === selectedWindLayer)
          if (!windLayer) return null

          // Startposition ist die aktuelle Ballonposition (geglättet)
          const startLat = displayGpsData.latitude
          const startLon = displayGpsData.longitude

          // Wind Direction: Wind kommt AUS dieser Richtung
          // Wenn "from" Modus: Pfeil zeigt wohin Wind weht (direction + 180)
          // Wenn "to" Modus: Pfeil zeigt woher Wind kommt (direction)
          const windDirectionRad = (windLayer.direction * Math.PI) / 180

          // Berechne Endpunkt der Windlinie (10km in Windrichtung)
          const lineLength = 10000 // 10km in Metern
          const earthRadius = 6371000 // Meter

          // Linie zeigt immer in Flugrichtung (wohin der Ballon fliegt = direction + 180)
          const flyDirection = (windLayer.direction + 180) % 360
          const flyDirectionRad = (flyDirection * Math.PI) / 180

          const latDiff = (lineLength * Math.cos(flyDirectionRad)) / earthRadius * (180 / Math.PI)
          const lonDiff = (lineLength * Math.sin(flyDirectionRad)) / (earthRadius * Math.cos(startLat * Math.PI / 180)) * (180 / Math.PI)

          const endLat = startLat + latDiff
          const endLon = startLon + lonDiff

          // Formatiere Windrichtung
          const formatWindDirection = () => {
            if (settings.windDirectionMode === 'from') {
              return windLayer.direction.toString().padStart(3, '0')
            } else {
              const toDirection = (windLayer.direction + 180) % 360
              return toDirection.toString().padStart(3, '0')
            }
          }

          return (
            <React.Fragment>
              {/* Schwarzer Rand für Kontrast */}
              <Polyline
                positions={[
                  [startLat, startLon],
                  [endLat, endLon]
                ]}
                pathOptions={{
                  color: '#000000',
                  weight: 8,
                  opacity: 0.5
                }}
              />
              {/* Wind-Linie in Cyan */}
              <Polyline
                positions={[
                  [startLat, startLon],
                  [endLat, endLon]
                ]}
                pathOptions={{
                  color: '#06b6d4',
                  weight: 4,
                  opacity: 1
                }}
              />
              {/* Pfeilspitze am Ende */}
              <Marker
                position={[endLat, endLon]}
                icon={L.divIcon({
                  className: 'wind-arrow-head',
                  html: `
                    <div style="
                      width: 0;
                      height: 0;
                      border-left: 12px solid transparent;
                      border-right: 12px solid transparent;
                      border-bottom: 20px solid #06b6d4;
                      transform: translate(-50%, -50%) rotate(${flyDirection}deg);
                      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                    "></div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
              {/* Startpunkt mit Wind-Info */}
              <Marker
                position={[startLat, startLon]}
                icon={L.divIcon({
                  className: 'wind-layer-start',
                  html: `
                    <div style="
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      transform: translate(-50%, -100%);
                      margin-top: -10px;
                    ">
                      <div style="
                        background: #06b6d4;
                        color: white;
                        padding: 6px 10px;
                        border-radius: 6px;
                        font-size: 12px;
                        font-weight: 700;
                        white-space: nowrap;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        border: 2px solid white;
                      ">
                        💨 ${windLayer.altitude}m<br/>
                        ${formatWindDirection()}° / ${windLayer.speed.toFixed(1)} km/h
                      </div>
                      <div style="
                        width: 0;
                        height: 0;
                        border-left: 8px solid transparent;
                        border-right: 8px solid transparent;
                        border-top: 8px solid white;
                        margin-top: -2px;
                      "></div>
                    </div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
            </React.Fragment>
          )
        })()}

        {/* Clicked Position Marker */}
        {clickedPosition && (
          <Marker
            position={[clickedPosition.lat, clickedPosition.lon]}
            icon={clickIcon}
          >
            <Popup>
              <strong>Geklickte Position</strong><br />
              Lat: {clickedPosition.lat.toFixed(6)}<br />
              Lon: {clickedPosition.lon.toFixed(6)}
            </Popup>
          </Marker>
        )}

        {/* Balloon Position - verwendet geglättete GPS-Daten für flüssige Darstellung */}
        {displayGpsData && (
          <>
            {/* Heading-Linie */}
            {settings.balloonHeadingLine && (() => {
              const lineLength = settings.balloonHeadingLineLength || 1000 // Meter
              const heading = displayGpsData.heading || 0
              const headingRad = (heading * Math.PI) / 180
              const startLat = displayGpsData.latitude
              const startLon = displayGpsData.longitude

              // Berechnung des Endpunkts
              const earthRadius = 6371000 // Meter
              const latDiff = (lineLength * Math.cos(headingRad)) / earthRadius * (180 / Math.PI)
              const lonDiff = (lineLength * Math.sin(headingRad)) / (earthRadius * Math.cos(startLat * Math.PI / 180)) * (180 / Math.PI)

              const endLat = startLat + latDiff
              const endLon = startLon + lonDiff

              return (
                <Polyline
                  positions={[
                    [startLat, startLon],
                    [endLat, endLon]
                  ]}
                  pathOptions={{
                    color: settings.balloonHeadingLineColor || settings.balloonMarkerColor || '#e74c3c',
                    weight: settings.balloonHeadingLineWidth || 2,
                    opacity: 0.8,
                    dashArray: '10, 5'
                  }}
                />
              )
            })()}

            <SmoothBalloonMarker
              position={balloonPosition}
              heading={displayGpsData.heading || 0}
              size={settings.balloonMarkerSize || 'medium'}
              iconType={settings.balloonMarkerIcon || 'arrow'}
              color={settings.balloonMarkerColor || '#e74c3c'}
            />
          </>
        )}

        {/* Imported Trajectories (GPX/KML) */}
        {importedTrajectories.filter(t => t.visible).map(traj => (
          <TrajectoryPolyline key={traj.id} trajectory={traj} />
        ))}

        {/* Track */}
        {linePositions.length > 1 && (
          <>
            <Polyline
              positions={
                // Tracklinie ohne den letzten Punkt (der vor dem Cursor wäre)
                // Die aktuelle Position wird vom Balloon-Marker angezeigt
                displayGpsData && linePositions.length > 2
                  ? linePositions.slice(0, -1)
                  : linePositions
              }
              pathOptions={{
                color: settings.trackLineColor || '#1a73e8',
                weight: settings.trackLineWidth || 3,
                opacity: 0.8
              }}
              interactive={false}
            />

            {/* Track Point Markers mit Popup-Infos - nur anzeigen wenn nicht aufgezeichnet wird */}
            {settings.trackPointMarkers && !isRecording && track.map((point, index) => {
              // Farbe basierend auf Höhe
              const minAlt = Math.min(...track.map(t => t.position.altitude))
              const maxAlt = Math.max(...track.map(t => t.position.altitude))
              const altRange = maxAlt - minAlt
              const altPercent = altRange > 0 ? (point.position.altitude - minAlt) / altRange : 0

              // Grün (niedrig) → Gelb → Rot (hoch)
              let markerColor = '#22c55e' // Grün
              if (altPercent > 0.66) {
                markerColor = '#ef4444' // Rot
              } else if (altPercent > 0.33) {
                markerColor = '#f59e0b' // Orange/Gelb
              }

              // Format Zeit
              const formatTime = (date: Date) => {
                const h = date.getHours().toString().padStart(2, '0')
                const m = date.getMinutes().toString().padStart(2, '0')
                const s = date.getSeconds().toString().padStart(2, '0')
                return `${h}:${m}:${s}`
              }

              // Format Dauer
              const formatDuration = (seconds: number) => {
                const h = Math.floor(seconds / 3600)
                const m = Math.floor((seconds % 3600) / 60)
                const s = Math.floor(seconds % 60)
                if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                return `${m}:${s.toString().padStart(2, '0')}`
              }

              const icon = L.divIcon({
                html: `<div style="
                  width: 8px;
                  height: 8px;
                  background: ${markerColor};
                  border: 2px solid white;
                  border-radius: 50%;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                "></div>`,
                className: '',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
              })

              return (
                <Marker
                  key={`track-${index}`}
                  position={[point.position.latitude, point.position.longitude]}
                  icon={icon}
                  zIndexOffset={900}
                >
                  <Popup
                    className="dark-trackpoint-popup"
                    autoPan={true}
                    autoPanPadding={[80, 80]}
                    keepInView={true}
                    maxWidth={400}
                  >
                    {(() => {
                      // Berechne UTM Koordinaten
                      const utm = latLonToUTM(point.position.latitude, point.position.longitude)

                      // Berechne Grid Reference im eingestellten Format
                      const precision = settings.coordinateFormat === 'mgrs4' ? 4
                        : settings.coordinateFormat === 'mgrs5' ? 5
                        : settings.coordinateFormat === 'mgrs6' ? 6
                        : 5

                      // Grid Square Base aus Settings
                      const gridSquareEastBase = Math.floor(settings.utmBaseEasting / 100000) * 100000
                      const gridSquareNorthBase = Math.floor(settings.utmBaseNorthing / 100000) * 100000

                      // Meter innerhalb des 100km Squares berechnen
                      const eastMeters = Math.round(utm.easting - gridSquareEastBase)
                      const northMeters = Math.round(utm.northing - gridSquareNorthBase)

                      // Formatiere basierend auf Precision
                      const eastStr = eastMeters.toString().padStart(5, '0').substring(0, precision)
                      const northStr = northMeters.toString().padStart(5, '0').substring(0, precision)
                      const gridRef = `${eastStr} ${northStr}`

                      return (
                        <div style={{
                          fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                          fontSize: '12px',
                          background: 'rgba(10, 15, 30, 0.98)',
                          color: 'white',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          margin: '-13px -20px -13px -20px',
                          padding: '20px 24px',
                          minWidth: '340px'
                        }}>
                          {/* Header Zeile */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '12px',
                            paddingBottom: '12px',
                            borderBottom: '1px solid rgba(59, 130, 246, 0.3)'
                          }}>
                            <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              background: '#3b82f6',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white',
                              fontSize: '16px',
                              fontWeight: 700,
                              flexShrink: 0
                            }}>
                              {index + 1}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Trackpunkt</div>
                              <div style={{ fontSize: '16px', fontWeight: 600 }}>{formatTime(point.timestamp)}</div>
                              {point.timeFromStart !== undefined && (
                                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>+{formatDuration(point.timeFromStart)}</div>
                              )}
                            </div>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', flexShrink: 0 }}>
                              {settings.altitudeUnit === 'feet' ? Math.round(point.position.altitude * 3.28084) : Math.round(point.position.altitude)}{settings.altitudeUnit === 'feet' ? 'ft' : 'm'}
                            </div>
                          </div>

                          {/* Grid Reference */}
                          <div style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Grid ({precision}/{precision})</div>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b', letterSpacing: '2px' }}>{gridRef}</div>
                          </div>

                          {/* UTM */}
                          <div style={{ marginBottom: '4px' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>UTM: </span>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{utm.zone}{utm.hemisphere} {utm.easting.toFixed(0)}E {utm.northing.toFixed(0)}N</span>
                          </div>

                          {/* WGS84 */}
                          <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>WGS84: </span>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{point.position.latitude.toFixed(6)}° / {point.position.longitude.toFixed(6)}°</span>
                          </div>

                          {/* Flugdaten 2x2 Grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Baro</div>
                              <div style={{ fontSize: '16px', fontWeight: 600, color: '#3b82f6' }}>{settings.altitudeUnit === 'feet' ? Math.round(point.baro.pressureAltitude * 3.28084) : Math.round(point.baro.pressureAltitude)}{settings.altitudeUnit === 'feet' ? 'ft' : 'm'}</div>
                            </div>

                            {/* Geschwindigkeit */}
                            {point.speed !== undefined && (
                              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Speed</div>
                                <div style={{ fontSize: '16px', fontWeight: 600 }}>{(point.speed * 3.6).toFixed(1)} km/h</div>
                              </div>
                            )}

                            {/* Kurs */}
                            {point.heading !== undefined && (
                              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Kurs</div>
                                <div style={{ fontSize: '16px', fontWeight: 600 }}>{Math.round(point.heading)}°</div>
                              </div>
                            )}

                            {/* Vario */}
                            {point.verticalSpeed !== undefined && (
                              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Vario</div>
                                <div style={{ fontSize: '16px', fontWeight: 600, color: point.verticalSpeed > 0.1 ? '#22c55e' : point.verticalSpeed < -0.1 ? '#ef4444' : 'white' }}>
                                  {point.verticalSpeed > 0 ? '+' : ''}{point.verticalSpeed.toFixed(1)} m/s
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Distanz */}
                          {point.distance !== undefined && point.distance > 0 && (
                            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Distanz</span>
                              <span style={{ fontSize: '12px' }}>{point.distance.toFixed(1)} m</span>
                            </div>
                          )}

                          {/* Recording Reason */}
                          {point.recordingReason && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                              Aufgezeichnet: {point.recordingReason === 'time' ? 'Zeitintervall' : point.recordingReason === 'distance' ? 'Distanz' : 'Signifikant'}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </Popup>
                </Marker>
              )
            })}
          </>
        )}

        {/* Landeprognose - Abstiegslinie + Landepunkt (unabhängig vom Track) */}
        {showLandingPrediction && landingPrediction && landingPrediction.path.length > 1 && (
          <>
            {/* Schatten-Linie für bessere Sichtbarkeit */}
            <Polyline
              positions={landingPrediction.path.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{
                color: '#000',
                weight: 6,
                opacity: 0.3,
                dashArray: '8, 6'
              }}
              interactive={false}
            />
            {/* Abstiegslinie (gestrichelt, lila) */}
            <Polyline
              positions={landingPrediction.path.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{
                color: '#a855f7',
                weight: 4,
                opacity: 1,
                dashArray: '8, 6'
              }}
              interactive={false}
            />
            {/* Landepunkt-Marker */}
            <CircleMarker
              center={[landingPrediction.landingPoint.lat, landingPrediction.landingPoint.lon]}
              radius={10}
              pathOptions={{
                color: '#fff',
                fillColor: '#a855f7',
                fillOpacity: 0.9,
                weight: 3
              }}
            >
              <Tooltip permanent direction="right" offset={[12, 0]}>
                <div style={{ fontSize: '11px', fontWeight: 600 }}>
                  <div style={{ color: '#7c3aed' }}>Landepunkt</div>
                  <div>GND: {Math.round(landingPrediction.groundElevation)} m ({Math.round(landingPrediction.groundElevation * 3.28084)} ft)</div>
                  <div>Distanz: {landingPrediction.totalDistanceMeters < 1000
                    ? `${Math.round(landingPrediction.totalDistanceMeters)} m`
                    : `${(landingPrediction.totalDistanceMeters / 1000).toFixed(1)} km`
                  }</div>
                  <div>Zeit: {Math.floor(landingPrediction.totalTimeSeconds / 60)}:{String(Math.floor(landingPrediction.totalTimeSeconds % 60)).padStart(2, '0')} min</div>
                </div>
              </Tooltip>
            </CircleMarker>
            {/* Zielkreuz am Landepunkt */}
            <CircleMarker
              center={[landingPrediction.landingPoint.lat, landingPrediction.landingPoint.lon]}
              radius={18}
              pathOptions={{
                color: '#a855f7',
                fillColor: 'transparent',
                fillOpacity: 0,
                weight: 2,
                opacity: 0.6
              }}
              interactive={false}
            />
          </>
        )}

        {/* Drop Calculator - Falltrajektorie + Aufschlagpunkt */}
        {dropCalculator.active && dropCalculator.impactPoint && dropCalculator.path.length > 1 && (
          <>
            {/* Schatten-Linie */}
            <Polyline
              positions={dropCalculator.path.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '6, 4' }}
              interactive={false}
            />
            {/* Falltrajektorie (gestrichelt, orange) */}
            <Polyline
              positions={dropCalculator.path.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#f97316', weight: 3, opacity: 1, dashArray: '6, 4' }}
              interactive={false}
            />
            {/* Aufschlagpunkt-Marker */}
            <CircleMarker
              center={[dropCalculator.impactPoint.lat, dropCalculator.impactPoint.lon]}
              radius={8}
              pathOptions={{
                color: '#fff',
                fillColor: dropCalculator.insideMma ? '#22c55e' : '#f97316',
                fillOpacity: 0.9,
                weight: 3
              }}
              interactive={false}
            />
            {/* Äußerer Ring */}
            <CircleMarker
              center={[dropCalculator.impactPoint.lat, dropCalculator.impactPoint.lon]}
              radius={14}
              pathOptions={{ color: '#f97316', fillColor: 'transparent', fillOpacity: 0, weight: 2, opacity: 0.6 }}
              interactive={false}
            />
            {/* MMA-Kreis um Ziel */}
            {selectedGoal && selectedGoal.position && dropCalculator.mmaRadius && (
              <Circle
                center={[selectedGoal.position.latitude, selectedGoal.position.longitude]}
                radius={dropCalculator.mmaRadius}
                pathOptions={{
                  color: '#f97316', weight: 1, opacity: 0.4,
                  fillColor: '#f97316', fillOpacity: 0.05, dashArray: '4, 4'
                }}
                interactive={false}
              />
            )}
          </>
        )}

        {/* Steigpunkt-Rechner - Steig-Trajektorie + Endpunkt */}
        {climbPointResult && climbPointResult.path.length > 1 && (
          <>
            {/* Schatten-Linie */}
            <Polyline
              positions={climbPointResult.path.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '8, 6' }}
              interactive={false}
            />
            {/* Steig-Trajektorie (gestrichelt, cyan) */}
            <Polyline
              positions={climbPointResult.path.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#06b6d4', weight: 3, opacity: 1, dashArray: '8, 6' }}
              interactive={false}
            />
            {/* Linie vom Endpunkt zum Ziel (dünn, gestrichelt) */}
            {selectedGoal && selectedGoal.position && (
              <Polyline
                positions={[
                  [climbPointResult.bestPoint.lat, climbPointResult.bestPoint.lon],
                  [selectedGoal.position.latitude, selectedGoal.position.longitude]
                ]}
                pathOptions={{ color: '#06b6d4', weight: 1, opacity: 0.5, dashArray: '4, 8' }}
                interactive={false}
              />
            )}
            {/* Endpunkt-Marker */}
            <CircleMarker
              center={[climbPointResult.bestPoint.lat, climbPointResult.bestPoint.lon]}
              radius={8}
              pathOptions={{
                color: '#fff',
                fillColor: climbPointResult.distanceToGoal < 100 ? '#22c55e' : '#06b6d4',
                fillOpacity: 0.9,
                weight: 3
              }}
              interactive={false}
            />
            {/* Äußerer Ring */}
            <CircleMarker
              center={[climbPointResult.bestPoint.lat, climbPointResult.bestPoint.lon]}
              radius={14}
              pathOptions={{ color: '#06b6d4', fillColor: 'transparent', fillOpacity: 0, weight: 2, opacity: 0.6 }}
              interactive={false}
            />
          </>
        )}

        {/* Land Run Rechner - Dreieck + Pfade */}
        {landRunResult && (
          <>
            {/* Dreieck A-B-C (grün, semi-transparent) */}
            <Polygon
              positions={[
                [landRunResult.pointA.lat, landRunResult.pointA.lon],
                [landRunResult.pointB.lat, landRunResult.pointB.lon],
                [landRunResult.pointC.lat, landRunResult.pointC.lon]
              ]}
              pathOptions={{
                color: '#22c55e',
                weight: 2,
                opacity: 0.8,
                fillColor: '#22c55e',
                fillOpacity: 0.12
              }}
              interactive={false}
            />
            {/* Leg 1 Pfad: A → B (gestrichelt, grün) */}
            <Polyline
              positions={landRunResult.pathAB.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '8, 6' }}
              interactive={false}
            />
            <Polyline
              positions={landRunResult.pathAB.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#22c55e', weight: 3, opacity: 1, dashArray: '8, 6' }}
              interactive={false}
            />
            {/* Leg 2 Pfad: B → C (gestrichelt, grün, andere Strichelung) */}
            <Polyline
              positions={landRunResult.pathBC.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '4, 8' }}
              interactive={false}
            />
            <Polyline
              positions={landRunResult.pathBC.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.8, dashArray: '4, 8' }}
              interactive={false}
            />
            {/* Punkt A */}
            <CircleMarker
              center={[landRunResult.pointA.lat, landRunResult.pointA.lon]}
              radius={7}
              pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}
                className="dark-drop-tooltip"
              >
                <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '11px' }}>A</span>
              </Tooltip>
            </CircleMarker>
            {/* Punkt B */}
            <CircleMarker
              center={[landRunResult.pointB.lat, landRunResult.pointB.lon]}
              radius={7}
              pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}
                className="dark-drop-tooltip"
              >
                <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '11px' }}>B</span>
              </Tooltip>
            </CircleMarker>
            {/* Punkt C */}
            <CircleMarker
              center={[landRunResult.pointC.lat, landRunResult.pointC.lon]}
              radius={7}
              pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}
                className="dark-drop-tooltip"
              >
                <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '11px' }}>C</span>
              </Tooltip>
            </CircleMarker>
            {/* Flächen-Label im Zentrum */}
            <CircleMarker
              center={[
                (landRunResult.pointA.lat + landRunResult.pointB.lat + landRunResult.pointC.lat) / 3,
                (landRunResult.pointA.lon + landRunResult.pointB.lon + landRunResult.pointC.lon) / 3
              ]}
              radius={0}
              pathOptions={{ opacity: 0 }}
            >
              <Tooltip permanent direction="center" offset={[0, 0]}
                className="dark-drop-tooltip"
              >
                <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '12px' }}>
                  {landRunResult.triangleArea >= 10000
                    ? `${(landRunResult.triangleArea / 1000000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km²`
                    : `${landRunResult.triangleArea} m²`
                  }
                </span>
              </Tooltip>
            </CircleMarker>
            {/* Anflug-Pfad: Pilot → Punkt A (blau gestrichelt) */}
            {landRunResult.approachPath && landRunResult.approachPath.length > 1 && (
              <>
                <Polyline
                  positions={landRunResult.approachPath.map(p => [p.lat, p.lon] as [number, number])}
                  pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '6, 10' }}
                  interactive={false}
                />
                <Polyline
                  positions={landRunResult.approachPath.map(p => [p.lat, p.lon] as [number, number])}
                  pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.8, dashArray: '6, 10' }}
                  interactive={false}
                />
              </>
            )}
          </>
        )}

        {/* Angle Task Rechner - Leg1 (setDirection) + Leg2 (Abweichung) + Punkte */}
        {angleResult && (() => {
          // Richtungslinie: von Punkt A in setDirection, ~8km lang (deutlich sichtbar)
          const dirLineEnd = calculateDestination(
            angleResult.pointA.lat, angleResult.pointA.lon,
            angleResult.setDirection, 8000
          )
          return (
            <>
              {/* Set Direction Referenzlinie — leuchtend gelb, dick, durchgezogen */}
              <Polyline
                positions={[
                  [angleResult.pointA.lat, angleResult.pointA.lon],
                  [dirLineEnd.lat, dirLineEnd.lon]
                ]}
                pathOptions={{ color: '#000', weight: 6, opacity: 0.4 }}
                interactive={false}
              />
              <Polyline
                positions={[
                  [angleResult.pointA.lat, angleResult.pointA.lon],
                  [dirLineEnd.lat, dirLineEnd.lon]
                ]}
                pathOptions={{ color: '#facc15', weight: 3, opacity: 0.9 }}
                interactive={false}
              />
              {/* Label am Ende der Richtungslinie */}
              <CircleMarker
                center={[dirLineEnd.lat, dirLineEnd.lon]}
                radius={0}
                pathOptions={{ opacity: 0 }}
              >
                <Tooltip permanent direction="top" offset={[0, -5]}
                  className="dark-drop-tooltip"
                >
                  <span style={{ color: '#facc15', fontWeight: 700, fontSize: '10px' }}>
                    {angleResult.setDirection}° SET
                  </span>
                </Tooltip>
              </CircleMarker>
              {/* Leg 1 Pfad: Start → A (lila = vorgegebene Richtung) */}
              {angleResult.pathLeg1.length > 1 && (
                <>
                  <Polyline
                    positions={angleResult.pathLeg1.map(p => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '8, 6' }}
                    interactive={false}
                  />
                  <Polyline
                    positions={angleResult.pathLeg1.map(p => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#a855f7', weight: 3, opacity: 1, dashArray: '8, 6' }}
                    interactive={false}
                  />
                </>
              )}
              {/* Leg 2 Pfad: A → B (grün = Abweichung) */}
              {angleResult.pathLeg2.length > 1 && (
                <>
                  <Polyline
                    positions={angleResult.pathLeg2.map(p => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '4, 8' }}
                    interactive={false}
                  />
                  <Polyline
                    positions={angleResult.pathLeg2.map(p => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.9, dashArray: '4, 8' }}
                    interactive={false}
                  />
                </>
              )}
              {/* Anflug-Pfad: Pilot → Startpunkt (blau gestrichelt) */}
              {angleResult.approachPath && angleResult.approachPath.length > 1 && (
                <>
                  <Polyline
                    positions={angleResult.approachPath.map(p => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#000', weight: 5, opacity: 0.3, dashArray: '6, 10' }}
                    interactive={false}
                  />
                  <Polyline
                    positions={angleResult.approachPath.map(p => [p.lat, p.lon] as [number, number])}
                    pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.8, dashArray: '6, 10' }}
                    interactive={false}
                  />
                </>
              )}
              {/* Punkt A (lila) */}
              <CircleMarker
                center={[angleResult.pointA.lat, angleResult.pointA.lon]}
                radius={7}
                pathOptions={{ color: '#fff', fillColor: '#a855f7', fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -10]}
                  className="dark-drop-tooltip"
                >
                  <span style={{ color: '#a855f7', fontWeight: 700, fontSize: '11px' }}>A</span>
                </Tooltip>
              </CircleMarker>
              {/* Punkt B (grün) */}
              <CircleMarker
                center={[angleResult.pointB.lat, angleResult.pointB.lon]}
                radius={7}
                pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -10]}
                  className="dark-drop-tooltip"
                >
                  <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '11px' }}>B</span>
                </Tooltip>
              </CircleMarker>
              {/* Winkel-Label bei Punkt A */}
              <CircleMarker
                center={[angleResult.pointA.lat, angleResult.pointA.lon]}
                radius={0}
                pathOptions={{ opacity: 0 }}
              >
                <Tooltip permanent direction="right" offset={[15, 0]}
                  className="dark-drop-tooltip"
                >
                  <span style={{ color: '#a855f7', fontWeight: 700, fontSize: '12px' }}>
                    {angleResult.achievedAngle}°
                  </span>
                </Tooltip>
              </CircleMarker>
            </>
          )
        })()}

        {/* Selected Goal (hervorgehoben) */}
        {selectedGoal && selectedGoal.position && typeof selectedGoal.position.latitude === 'number' && typeof selectedGoal.position.longitude === 'number' && (() => {
          // Finde Task für Markerfarbe und Label
          const task = tasks.find(t => t.goals.some(g => g.id === selectedGoal.id))
          // Wenn der Task nicht mehr existiert (wurde gelöscht), rendere nichts
          if (!task) return null

          const taskIndex = tasks.findIndex(t => t.id === task?.id)
          const taskPrefix = settings.taskLabelPrefix ?? 'Task'
          const taskLabel = task?.taskNumber ? (taskPrefix ? `${taskPrefix} ${task.taskNumber}` : task.taskNumber) : ''
          const taskLabelWithSeparator = taskLabel ? `${taskLabel}: ` : ''

          // Nur verschiebbar wenn dieser Task im Panel geöffnet ist
          const isViewingThisTask = viewingTaskId === task?.id

          return (
          <>
            <DraggableGoalMarker
              goalId={selectedGoal.id}
              position={selectedGoal.position}
              draggable={goalDragMode && isViewingThisTask}
              icon={getGoalIcon(taskLabelWithSeparator, selectedGoal.name, false, goalDragMode && isViewingThisTask, true, task?.markerColor, settings.crossIconColor, settings.crossIconSize, settings.crossIconStrokeWidth, settings.taskLabelFontSize || 14, settings.taskLabelPadding || 6, task?.loggerId, task?.loggerGoalId, task?.markerColors, settings.loggerBadgeColor || '#10b981', settings.loggerGoalBadgeColor || '#f59e0b', settings.loggerBadgeFontSize || 11, settings.loggerGoalBadgeFontSize || 11)}
              zIndexOffset={500}
              onDragEnd={(id, lat, lng) => updateGoalPosition(id, lat, lng)}
              measureModeActive={showMeasureTool && !measureAreaCompleted}
              onMeasureClick={(lat, lon) => setMeasurePoints(prev => [...prev, { lat, lon }])}
              onClick={(e) => {
                // Wenn Wind-Linien-Modus aktiv, Windlinie vom Goal aus zeichnen
                if (windLineMode && pendingWindLayer) {
                  e.originalEvent.stopPropagation()
                  addWindLine({
                    startPosition: { lat: selectedGoal.position.latitude, lon: selectedGoal.position.longitude },
                    windLayer: pendingWindLayer
                  })
                  return
                }
                // Wenn HDG-Kurs-Modus aktiv, Kurslinie vom Goal aus zeichnen
                if (hdgCourseMode && hdgPendingCourse !== null) {
                  e.originalEvent.stopPropagation()
                  addHdgCourseLine({
                    startPosition: { lat: selectedGoal.position.latitude, lon: selectedGoal.position.longitude },
                    course: hdgPendingCourse,
                    lineMode: hdgPendingLineMode
                  })
                }
              }}
              onDblClick={(e) => {
                e.originalEvent.stopPropagation()
                const foundTask = tasks.find(t => t.goals.some(g => g.id === selectedGoal.id))
                if (foundTask) {
                  setViewingTaskId(foundTask.id)
                }
              }}
            />

            {/* Navigation Line - Von aktueller Position zum Goal (geglättet für flüssige Darstellung) */}
            {displayGpsData && settings.navLineEnabled && (
              <>
                {/* Schwarzer Rand für besseren Kontrast */}
                <Polyline
                  positions={[
                    [displayGpsData.latitude, displayGpsData.longitude],
                    [selectedGoal.position.latitude, selectedGoal.position.longitude]
                  ]}
                  pathOptions={{
                    color: '#000000',
                    weight: (settings.navLineWidth || 5) + 3,
                    opacity: 0.5
                  }}
                  interactive={false}
                />
                {/* Hauptlinie in gewählter Farbe */}
                <Polyline
                  positions={[
                    [displayGpsData.latitude, displayGpsData.longitude],
                    [selectedGoal.position.latitude, selectedGoal.position.longitude]
                  ]}
                  pathOptions={{
                    color: settings.navLineColor || '#22c55e',
                    weight: settings.navLineWidth || 5,
                    opacity: 1
                  }}
                  interactive={false}
                />

                {/* Kurs-Anzeige entlang der Linie */}
                {settings.navLineShowCourse && (() => {
                  // Berechne Distanz zum Ziel (Haversine Formel)
                  const R = 6371000 // Erdradius in Metern
                  const lat1Rad = displayGpsData.latitude * Math.PI / 180
                  const lat2Rad = selectedGoal.position.latitude * Math.PI / 180
                  const dLatRad = (selectedGoal.position.latitude - displayGpsData.latitude) * Math.PI / 180
                  const dLonRad = (selectedGoal.position.longitude - displayGpsData.longitude) * Math.PI / 180

                  const a = Math.sin(dLatRad/2) * Math.sin(dLatRad/2) +
                            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                            Math.sin(dLonRad/2) * Math.sin(dLonRad/2)
                  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
                  const distanceToGoal = R * c // Distanz in Metern

                  // Prüfe ob Badge ausgeblendet werden soll
                  const hideDistance = settings.navLineCourseHideDistance || 0
                  if (hideDistance > 0 && distanceToGoal < hideDistance) {
                    return null // Badge nicht anzeigen wenn zu nah
                  }

                  // Berechne Bearing (Kurs) von aktueller Position zum Ziel
                  const lat1 = displayGpsData.latitude * Math.PI / 180
                  const lat2 = selectedGoal.position.latitude * Math.PI / 180
                  const dLon = (selectedGoal.position.longitude - displayGpsData.longitude) * Math.PI / 180

                  const y = Math.sin(dLon) * Math.cos(lat2)
                  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
                  let bearing = Math.atan2(y, x) * 180 / Math.PI
                  bearing = (bearing + 360) % 360  // Normalize to 0-360

                  // Berechne Mittelpunkt für Label-Position
                  const midLat = (displayGpsData.latitude + selectedGoal.position.latitude) / 2
                  const midLon = (displayGpsData.longitude + selectedGoal.position.longitude) / 2

                  // Calculate line angle for rotation (0° = North, clockwise)
                  // Adjust rotation so text runs along the line
                  let textRotation = bearing - 90  // Subtract 90° to align with line direction

                  // Keep text readable (not upside down)
                  if (textRotation > 90 || textRotation < -90) {
                    textRotation += 180
                  }

                  return (
                    <Marker
                      position={[midLat, midLon]}
                      icon={L.divIcon({
                        className: 'course-label',
                        html: `<div style="
                          display: inline-block;
                          background: rgba(255, 255, 255, 0.95);
                          color: #000;
                          padding: 3px 7px;
                          border-radius: 4px;
                          font-size: 13px;
                          font-weight: 700;
                          white-space: nowrap;
                          transform: translate(-50%, -50%) rotate(${textRotation}deg);
                          transform-origin: center;
                          border: 2px solid #000;
                          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        ">${Math.round(bearing).toString().padStart(3, '0')}°</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                      })}
                    />
                  )
                })()}
              </>
            )}
          </>
          )
        })()}

        {/* Task MMA Circle und Rings */}
        {activeTask && selectedGoal && selectedGoal.position && typeof selectedGoal.position.latitude === 'number' && typeof selectedGoal.position.longitude === 'number' && (
          <>
            {/* MMA Circle - nur anzeigen wenn mmaRadius > 0 */}
            {activeTask.mmaRadius && activeTask.mmaRadius > 0 && (
              <>
                <Circle
                  center={[selectedGoal.position.latitude, selectedGoal.position.longitude]}
                  radius={activeTask.mmaRadius}
                  pathOptions={{
                    color: activeTask.mmaLineColor || settings.defaultMmaLineColor,
                    fillColor: (settings.mmaFillEnabled && !settings.mmaFillDashed) ? (activeTask.mmaFillColor || settings.defaultMmaFillColor) : 'transparent',
                    fillOpacity: (settings.mmaFillEnabled && !settings.mmaFillDashed) ? 0.15 : 0,
                    weight: 2,
                    dashArray: settings.mmaBorderDashed ? '5, 5' : undefined,
                    opacity: 0.8
                  }}
                />
                {/* Schraffur wenn aktiviert */}
                {settings.mmaFillEnabled && settings.mmaFillDashed && (
                  <CircleHatch
                    center={[selectedGoal.position.latitude, selectedGoal.position.longitude]}
                    radius={activeTask.mmaRadius}
                    color={activeTask.mmaFillColor || settings.defaultMmaFillColor}
                  />
                )}
              </>
            )}

            {/* Task Rings - auch für aktiven Task */}
            {(settings.showTaskRings !== false) && activeTask.rings && activeTask.rings.map((radius, index) => {
              const defaultColors = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e']
              const colors = settings.ringColors || defaultColors
              const lineWidth = settings.ringLineWidth || 2
              const dashed = settings.ringDashed !== false

              return (
                <Circle
                  key={`active-ring-${index}`}
                  center={[selectedGoal.position.latitude, selectedGoal.position.longitude]}
                  radius={radius}
                  pathOptions={{
                    color: colors[index] || '#ffffff',
                    fillColor: 'transparent',
                    weight: lineWidth,
                    dashArray: dashed ? '10, 10' : undefined,
                    opacity: 0.7
                  }}
                />
              )
            })}
            {/* Legacy Support für aktiven Task */}
            {(settings.showTaskRings !== false) && !activeTask.rings && activeTask.minDistance && (
              <Circle
                key="active-ring-min"
                center={[selectedGoal.position.latitude, selectedGoal.position.longitude]}
                radius={activeTask.minDistance}
                pathOptions={{
                  color: (settings.ringColors && settings.ringColors[0]) || '#ef4444',
                  fillColor: 'transparent',
                  weight: settings.ringLineWidth || 2,
                  dashArray: (settings.ringDashed !== false) ? '10, 10' : undefined,
                  opacity: 0.7
                }}
              />
            )}
            {(settings.showTaskRings !== false) && !activeTask.rings && activeTask.maxDistance && (
              <Circle
                key="active-ring-max"
                center={[selectedGoal.position.latitude, selectedGoal.position.longitude]}
                radius={activeTask.maxDistance}
                pathOptions={{
                  color: (settings.ringColors && settings.ringColors[3]) || '#22c55e',
                  fillColor: 'transparent',
                  weight: settings.ringLineWidth || 2,
                  dashArray: (settings.ringDashed !== false) ? '10, 10' : undefined,
                  opacity: 0.7
                }}
              />
            )}

            {/* Scoring Area */}
            {activeTask.scoringArea && activeTask.scoringArea.visible !== false && (
              <>
                {activeTask.scoringArea.type === 'circle' && activeTask.scoringArea.center && typeof activeTask.scoringArea.center.latitude === 'number' && typeof activeTask.scoringArea.center.longitude === 'number' && activeTask.scoringArea.radius && (
                  <Circle
                    center={[activeTask.scoringArea.center.latitude, activeTask.scoringArea.center.longitude]}
                    radius={activeTask.scoringArea.radius}
                    pathOptions={{
                      color: activeTask.scoringArea.color || '#3b82f6',
                      fillColor: activeTask.scoringArea.fillColor || '#3b82f6',
                      fillOpacity: 0.2,
                      weight: 2,
                      opacity: 0.8
                    }}
                  />
                )}

                {activeTask.scoringArea.type === 'polygon' && activeTask.scoringArea.points && activeTask.scoringArea.points.length >= 3 && (
                  <Polygon
                    positions={activeTask.scoringArea.points.map(p => [p.latitude, p.longitude])}
                    pathOptions={{
                      color: activeTask.scoringArea.color || '#3b82f6',
                      fillColor: activeTask.scoringArea.fillColor || '#3b82f6',
                      fillOpacity: 0.2,
                      weight: 2,
                      opacity: 0.8
                    }}
                  />
                )}

                {activeTask.scoringArea.type === 'sector' && activeTask.scoringArea.center && typeof activeTask.scoringArea.center.latitude === 'number' && typeof activeTask.scoringArea.center.longitude === 'number' && activeTask.scoringArea.radius && (
                  (() => {
                    const center = activeTask.scoringArea.center!
                    const radius = activeTask.scoringArea.radius!
                    const startAngle = activeTask.scoringArea.startAngle || 0
                    const endAngle = activeTask.scoringArea.endAngle || 90

                    // Convert angles to radians
                    const startRad = (startAngle - 90) * Math.PI / 180
                    const endRad = (endAngle - 90) * Math.PI / 180

                    // Create sector path with multiple points for smooth arc
                    const points: [number, number][] = [[center.latitude, center.longitude]]
                    const steps = 50

                    for (let i = 0; i <= steps; i++) {
                      const angle = startRad + (endRad - startRad) * (i / steps)
                      const lat = center.latitude + (radius / 111320) * Math.sin(angle)
                      const lon = center.longitude + (radius / (111320 * Math.cos(center.latitude * Math.PI / 180))) * Math.cos(angle)
                      points.push([lat, lon])
                    }

                    points.push([center.latitude, center.longitude])

                    return (
                      <Polygon
                        positions={points}
                        pathOptions={{
                          color: activeTask.scoringArea.color || '#3b82f6',
                          fillColor: activeTask.scoringArea.fillColor || '#3b82f6',
                          fillOpacity: 0.2,
                          weight: 2,
                          opacity: 0.8
                        }}
                      />
                    )
                  })()
                )}
              </>
            )}
          </>
        )}

        {/* Marker Drops - kleine rote Punkte mit Popup bei Klick */}
        {markers.map((marker) => {
          // Berechne Grid Reference basierend auf Präzision-Einstellung
          const utm = latLonToUTM(marker.position.latitude, marker.position.longitude)
          const precision = settings.coordinateFormat === 'mgrs4' ? 4 :
                           settings.coordinateFormat === 'mgrs5' ? 5 : 6

          // Nimm die letzten 5 Stellen der UTM-Koordinate (innerhalb 100km Grid Square)
          const eastingWithin100k = Math.round(utm.easting % 100000)
          const northingWithin100k = Math.round(utm.northing % 100000)

          // Formatiere auf gewünschte Präzision (4, 5 oder 6 Stellen)
          const eastStr = eastingWithin100k.toString().padStart(5, '0').slice(0, precision)
          const northStr = northingWithin100k.toString().padStart(5, '0').slice(0, precision)
          const gridRef = `${eastStr} ${northStr}`

          return (
            <Marker
              key={marker.id}
              position={[marker.position.latitude, marker.position.longitude]}
              icon={createDropMarkerIcon(marker.number)}
              zIndexOffset={2000}
              eventHandlers={{
                mouseover: (e) => {
                  const containerPoint = e.containerPoint
                  setHoveredDropMarker(marker.id)
                  setDropMarkerHoverPos({ x: containerPoint.x, y: containerPoint.y })
                  setHoveredMarkerScreenPos({ x: containerPoint.x, y: containerPoint.y })
                }
              }}
            />
          )
        })}

        {/* Waypoints */}
        {waypoints.map((waypoint) => (
          <Marker
            key={waypoint.id}
            position={[waypoint.position.latitude, waypoint.position.longitude]}
            icon={waypointIcon}
          >
            <Popup>
              <strong>{waypoint.name}</strong><br />
              {waypoint.description}
            </Popup>
          </Marker>
        ))}

        {/* Alle Tasks immer anzeigen */}
        {tasks.map((task, taskIndex) => {
          const isActiveTask = activeTask?.id === task.id

          return task.goals.map((goal) => {
            const isSelectedGoal = selectedGoal?.id === goal.id

            // Überspringe das ausgewählte Goal (wird oben separat gerendert)
            if (isSelectedGoal) return null

            // Überspringe Goals ohne gültige Position
            if (!goal.position || typeof goal.position.latitude !== 'number' || typeof goal.position.longitude !== 'number') return null

            return (
              <React.Fragment key={`${task.id}-${goal.id}`}>
                {/* MMA Circle - für alle Tasks */}
                {task.mmaRadius && task.mmaRadius > 0 && (
                  <>
                    <Circle
                      center={[goal.position.latitude, goal.position.longitude]}
                      radius={task.mmaRadius}
                      pathOptions={{
                        color: task.mmaLineColor || settings.defaultMmaLineColor,
                        fillColor: (settings.mmaFillEnabled && !settings.mmaFillDashed) ? (task.mmaFillColor || settings.defaultMmaFillColor) : 'transparent',
                        fillOpacity: (settings.mmaFillEnabled && !settings.mmaFillDashed) ? 0.15 : 0,
                        weight: 2,
                        dashArray: settings.mmaBorderDashed ? '5, 5' : undefined,
                        opacity: 0.8
                      }}
                    />
                    {/* Schraffur wenn aktiviert */}
                    {settings.mmaFillEnabled && settings.mmaFillDashed && (
                      <CircleHatch
                        center={[goal.position.latitude, goal.position.longitude]}
                        radius={task.mmaRadius}
                        color={task.mmaFillColor || settings.defaultMmaFillColor}
                      />
                    )}
                  </>
                )}

                {/* Task Rings - für ALLE Tasks wenn Rings definiert sind */}
                {(settings.showTaskRings !== false) && task.rings && task.rings.map((radius, index) => {
                  const defaultColors = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e']
                  const colors = settings.ringColors || defaultColors
                  const lineWidth = settings.ringLineWidth || 2
                  const dashed = settings.ringDashed !== false

                  return (
                    <Circle
                      key={`ring-${task.id}-${goal.id}-${index}`}
                      center={[goal.position.latitude, goal.position.longitude]}
                      radius={radius}
                      pathOptions={{
                        color: colors[index] || '#ffffff',
                        fillColor: 'transparent',
                        weight: lineWidth,
                        dashArray: dashed ? '10, 10' : undefined,
                        opacity: 0.7
                      }}
                    />
                  )
                })}
                {/* Legacy Support: minDistance und maxDistance für alte Tasks */}
                {(settings.showTaskRings !== false) && !task.rings && task.minDistance && (
                  <Circle
                    key={`ring-${task.id}-${goal.id}-min`}
                    center={[goal.position.latitude, goal.position.longitude]}
                    radius={task.minDistance}
                    pathOptions={{
                      color: (settings.ringColors && settings.ringColors[0]) || '#ef4444',
                      fillColor: 'transparent',
                      weight: settings.ringLineWidth || 2,
                      dashArray: (settings.ringDashed !== false) ? '10, 10' : undefined,
                      opacity: 0.7
                    }}
                  />
                )}
                {(settings.showTaskRings !== false) && !task.rings && task.maxDistance && (
                  <Circle
                    key={`ring-${task.id}-${goal.id}-max`}
                    center={[goal.position.latitude, goal.position.longitude]}
                    radius={task.maxDistance}
                    pathOptions={{
                      color: (settings.ringColors && settings.ringColors[3]) || '#22c55e',
                      fillColor: 'transparent',
                      weight: settings.ringLineWidth || 2,
                      dashArray: (settings.ringDashed !== false) ? '10, 10' : undefined,
                      opacity: 0.7
                    }}
                  />
                )}

                {/* Goal Marker Icon */}
                <DraggableGoalMarker
                  goalId={goal.id}
                  position={goal.position}
                  draggable={goalDragMode && viewingTaskId === task.id}
                  icon={getGoalIcon(
                    task.taskNumber ? ((settings.taskLabelPrefix ?? 'Task') ? `${settings.taskLabelPrefix ?? 'Task'} ${task.taskNumber}: ` : `${task.taskNumber}: `) : '',
                    goal.name,
                    isActiveTask,
                    goalDragMode && viewingTaskId === task.id,
                    false,
                    task.markerColor,
                    settings.crossIconColor,
                    settings.crossIconSize,
                    settings.crossIconStrokeWidth,
                    settings.taskLabelFontSize || 14,
                    settings.taskLabelPadding || 6,
                    task.loggerId,
                    task.loggerGoalId,
                    task.markerColors,
                    settings.loggerBadgeColor || '#10b981',
                    settings.loggerGoalBadgeColor || '#f59e0b',
                    settings.loggerBadgeFontSize || 11,
                    settings.loggerGoalBadgeFontSize || 11
                  )}
                  zIndexOffset={500}
                  onDragEnd={(id, lat, lng) => updateGoalPosition(id, lat, lng)}
                  measureModeActive={showMeasureTool && !measureAreaCompleted}
                  onMeasureClick={(lat, lon) => setMeasurePoints(prev => [...prev, { lat, lon }])}
                  onClick={(e) => {
                    // Wenn Wind-Linien-Modus aktiv, Windlinie vom Goal aus zeichnen
                    if (windLineMode && pendingWindLayer) {
                      e.originalEvent.stopPropagation()
                      addWindLine({
                        startPosition: { lat: goal.position.latitude, lon: goal.position.longitude },
                        windLayer: pendingWindLayer
                      })
                      return
                    }
                    // Wenn HDG-Kurs-Modus aktiv, Kurslinie vom Goal aus zeichnen
                    if (hdgCourseMode && hdgPendingCourse !== null) {
                      e.originalEvent.stopPropagation()
                      addHdgCourseLine({
                        startPosition: { lat: goal.position.latitude, lon: goal.position.longitude },
                        course: hdgPendingCourse,
                        lineMode: hdgPendingLineMode
                      })
                    }
                  }}
                  onDblClick={(e) => {
                    e.originalEvent.stopPropagation()
                    setViewingTaskId(task.id)
                  }}
                />
              </React.Fragment>
            )
          })
        })}

        {/* Scoring Areas für alle Tasks (außer aktiver Task, der wird oben gerendert) */}
        {tasks.filter(task => task.id !== activeTask?.id).map((task) => {
          if (!task.scoringArea || task.scoringArea.visible === false) return null

          return (
            <React.Fragment key={`scoring-area-${task.id}`}>
              {task.scoringArea.type === 'circle' && task.scoringArea.center && typeof task.scoringArea.center.latitude === 'number' && typeof task.scoringArea.center.longitude === 'number' && task.scoringArea.radius && (
                <Circle
                  center={[task.scoringArea.center.latitude, task.scoringArea.center.longitude]}
                  radius={task.scoringArea.radius}
                  pathOptions={{
                    color: task.scoringArea.color || '#3b82f6',
                    fillColor: task.scoringArea.fillColor || '#3b82f6',
                    fillOpacity: 0.15,
                    weight: 2,
                    opacity: 0.6
                  }}
                />
              )}

              {task.scoringArea.type === 'polygon' && task.scoringArea.points && task.scoringArea.points.length >= 3 && (
                <Polygon
                  positions={task.scoringArea.points.map(p => [p.latitude, p.longitude])}
                  pathOptions={{
                    color: task.scoringArea.color || '#3b82f6',
                    fillColor: task.scoringArea.fillColor || '#3b82f6',
                    fillOpacity: 0.15,
                    weight: 2,
                    opacity: 0.6
                  }}
                />
              )}

              {task.scoringArea.type === 'sector' && task.scoringArea.center && typeof task.scoringArea.center.latitude === 'number' && typeof task.scoringArea.center.longitude === 'number' && task.scoringArea.radius && (
                (() => {
                  const center = task.scoringArea.center!
                  const radius = task.scoringArea.radius!
                  const startAngle = task.scoringArea.startAngle || 0
                  const endAngle = task.scoringArea.endAngle || 90

                  // Convert angles to radians
                  const startRad = (startAngle - 90) * Math.PI / 180
                  const endRad = (endAngle - 90) * Math.PI / 180

                  // Create sector path with multiple points for smooth arc
                  const points: [number, number][] = [[center.latitude, center.longitude]]
                  const steps = 50

                  for (let i = 0; i <= steps; i++) {
                    const angle = startRad + (endRad - startRad) * (i / steps)
                    const lat = center.latitude + (radius / 111320) * Math.sin(angle)
                    const lon = center.longitude + (radius / (111320 * Math.cos(center.latitude * Math.PI / 180))) * Math.cos(angle)
                    points.push([lat, lon])
                  }

                  points.push([center.latitude, center.longitude])

                  return (
                    <Polygon
                      positions={points}
                      pathOptions={{
                        color: task.scoringArea.color || '#3b82f6',
                        fillColor: task.scoringArea.fillColor || '#3b82f6',
                        fillOpacity: 0.15,
                        weight: 2,
                        opacity: 0.6
                      }}
                    />
                  )
                })()
              )}
            </React.Fragment>
          )
        })}

        {/* Independent Scoring Areas - UNTER den Markern (zIndex 399 < Marker 400+) */}
        <Pane name="scoringAreasPane" style={{ zIndex: 399 }}>
          {scoringAreas.filter(area => area.visible !== false).map((area, index) => (
            <React.Fragment key={`scoring-${area.id}-${index}`}>
              {area.type === 'circle' && area.center && typeof area.center.latitude === 'number' && typeof area.center.longitude === 'number' && area.radius && (
                <Circle
                  center={[area.center.latitude, area.center.longitude]}
                  radius={area.radius}
                  interactive={false}
                  pathOptions={{
                    color: area.color || '#3b82f6',
                    fillColor: area.fillColor || '#3b82f6',
                    fillOpacity: 0.15,
                    weight: 2,
                    opacity: 0.6
                  }}
                />
              )}

              {area.type === 'polygon' && area.points && area.points.length > 0 && (
                // Wenn fillColor 'transparent' ist, als Polyline rendern (keine geschlossene Form)
                area.fillColor === 'transparent' ? (
                  <Polyline
                    positions={area.points.map(p => [p.latitude, p.longitude] as [number, number])}
                    interactive={false}
                    pathOptions={{
                      color: area.color || '#3b82f6',
                      weight: settings.lineWidth || 3,
                      opacity: 0.8
                    }}
                  />
                ) : (
                  <Polygon
                    positions={area.points.map(p => [p.latitude, p.longitude])}
                    interactive={false}
                    pathOptions={{
                      color: area.color || '#3b82f6',
                      fillColor: area.fillColor || '#3b82f6',
                      fillOpacity: 0.15,
                      weight: area.points.length === 2 ? (settings.lineWidth || 3) : 2,
                      opacity: 0.6
                    }}
                  />
                )
              )}

            {area.type === 'sector' && area.center && typeof area.center.latitude === 'number' && typeof area.center.longitude === 'number' && area.radius && area.startAngle !== undefined && area.endAngle !== undefined && (
              (() => {
                const center = area.center!
                const radius = area.radius!
                const startAngle = area.startAngle!
                const endAngle = area.endAngle!

                // Convert angles to radians
                const startRad = (startAngle - 90) * Math.PI / 180
                const endRad = (endAngle - 90) * Math.PI / 180

                // Create sector path with multiple points for smooth arc
                const points: [number, number][] = [[center.latitude, center.longitude]]
                const steps = 50

                for (let i = 0; i <= steps; i++) {
                  const angle = startRad + (endRad - startRad) * (i / steps)
                  const lat = center.latitude + (radius / 111320) * Math.sin(angle)
                  const lon = center.longitude + (radius / (111320 * Math.cos(center.latitude * Math.PI / 180))) * Math.cos(angle)
                  points.push([lat, lon])
                }

                points.push([center.latitude, center.longitude])

                return (
                  <Polygon
                    positions={points}
                    pathOptions={{
                      color: area.color || '#3b82f6',
                      fillColor: area.fillColor || '#3b82f6',
                      fillOpacity: 0.15,
                      weight: 2,
                      opacity: 0.6
                    }}
                  />
                )
              })()
            )}
          </React.Fragment>
          ))}
        </Pane>

        {/* Drawing Preview - show temporary shapes while drawing */}
        {drawingMode !== 'none' && (
          <>
            {/* Circle Preview */}
            {drawingMode === 'circle' && drawingCenter && (
              <>
                <Circle
                  center={[drawingCenter.lat, drawingCenter.lon]}
                  radius={drawingRadius}
                  pathOptions={{
                    color: '#3b82f6',
                    fillColor: '#3b82f6',
                    fillOpacity: 0.1,
                    weight: 2,
                    opacity: 0.8,
                    dashArray: '5, 5'
                  }}
                />
                <Marker position={[drawingCenter.lat, drawingCenter.lon]} icon={L.divIcon({
                  className: 'center-marker',
                  html: '<div style="width: 8px; height: 8px; background: #3b82f6; border: 2px solid white; border-radius: 50%;"></div>',
                  iconSize: [12, 12],
                  iconAnchor: [6, 6]
                })} />
              </>
            )}

            {/* Line Preview */}
            {drawingMode === 'line' && drawingPoints.length > 0 && (
              <>
                {drawingPoints.map((point, index) => (
                  <Marker
                    key={index}
                    position={[point.lat, point.lon]}
                    icon={L.divIcon({
                      className: 'line-point',
                      html: `<div style="width: 10px; height: 10px; background: ${settings.drawingLineColor || '#3b82f6'}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 6px rgba(59,130,246,0.6);"></div>`,
                      iconSize: [14, 14],
                      iconAnchor: [7, 7]
                    })}
                  />
                ))}
              </>
            )}

            {/* Freehand Preview */}
            {drawingMode === 'freehand' && drawingPoints.length > 0 && (
              <>
                {drawingPoints.map((point, index) => (
                  <Marker
                    key={index}
                    position={[point.lat, point.lon]}
                    icon={L.divIcon({
                      className: 'freehand-point',
                      html: `<div style="width: 12px; height: 12px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 8px rgba(59,130,246,0.8);"></div>`,
                      iconSize: [18, 18],
                      iconAnchor: [9, 9]
                    })}
                  />
                ))}
                {drawingPoints.length >= 2 && (
                  <Polyline
                    positions={drawingPoints.map(p => [p.lat, p.lon])}
                    pathOptions={{
                      color: '#3b82f6',
                      weight: 4,
                      opacity: 0.9
                    }}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* Team Members - andere Piloten im Live Team */}
        {teamSession && teamMembers
          .filter(m => m.id !== myTeamMemberId && !hiddenTeamMembers.has(m.id))
          .map(member => {
            const pos = member.currentPosition
            return (
              <React.Fragment key={member.id}>
                {/* Track-Polyline des Team-Mitglieds */}
                {member.track.length > 1 && (
                  <Polyline
                    positions={member.track}
                    pathOptions={{
                      color: member.color,
                      weight: 2,
                      opacity: 0.6,
                      dashArray: '6, 4'
                    }}
                  />
                )}

                {/* Trackpunkt-Marker (kleine Dots mit Popup bei Klick) */}
                {member.trackPoints.map((tp, idx) => {
                  // UTM Koordinaten berechnen
                  const utm = latLonToUTM(tp.latitude, tp.longitude)
                  const precision = settings.coordinateFormat === 'mgrs4' ? 4
                    : settings.coordinateFormat === 'mgrs5' ? 5
                    : settings.coordinateFormat === 'mgrs6' ? 6
                    : 5
                  const gridSquareEastBase = Math.floor(settings.utmBaseEasting / 100000) * 100000
                  const gridSquareNorthBase = Math.floor(settings.utmBaseNorthing / 100000) * 100000
                  const eastMeters = Math.round(utm.easting - gridSquareEastBase)
                  const northMeters = Math.round(utm.northing - gridSquareNorthBase)
                  const eastStr = eastMeters.toString().padStart(5, '0').substring(0, precision)
                  const northStr = northMeters.toString().padStart(5, '0').substring(0, precision)
                  const gridRef = `${eastStr} ${northStr}`

                  return (
                    <Marker
                      key={`tp-${member.id}-${idx}`}
                      position={[tp.latitude, tp.longitude]}
                      icon={L.divIcon({
                        className: 'team-trackpoint',
                        html: `<div style="
                          width: 6px;
                          height: 6px;
                          background: ${member.color};
                          border: 1px solid rgba(255,255,255,0.8);
                          border-radius: 50%;
                          opacity: 0.7;
                        "></div>`,
                        iconSize: [8, 8],
                        iconAnchor: [4, 4]
                      })}
                      interactive={true}
                    >
                      <Popup
                        className="dark-trackpoint-popup"
                        autoPan={true}
                        autoPanPadding={[80, 80]}
                        keepInView={true}
                        maxWidth={400}
                      >
                        <div style={{
                          fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                          fontSize: '12px',
                          background: 'rgba(10, 15, 30, 0.98)',
                          color: 'white',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          margin: '-13px -20px -13px -20px',
                          padding: '20px 24px',
                          minWidth: '320px'
                        }}>
                          {/* Header Zeile */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '12px',
                            paddingBottom: '12px',
                            borderBottom: `1px solid ${member.color}50`
                          }}>
                            <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              background: member.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white',
                              fontSize: '14px',
                              fontWeight: 700,
                              flexShrink: 0
                            }}>
                              {idx + 1}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Team Trackpunkt</div>
                              <div style={{ fontSize: '15px', fontWeight: 600, color: member.color }}>{member.callsign}</div>
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{tp.recordedAt.toLocaleTimeString('de-DE')}</div>
                            </div>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', flexShrink: 0 }}>
                              {settings.altitudeUnit === 'feet' ? Math.round(tp.altitude * 3.28084) : Math.round(tp.altitude)}{settings.altitudeUnit === 'feet' ? 'ft' : 'm'}
                            </div>
                          </div>

                          {/* Grid Reference */}
                          <div style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Grid ({precision}/{precision})</div>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b', letterSpacing: '2px' }}>{gridRef}</div>
                          </div>

                          {/* UTM */}
                          <div style={{ marginBottom: '4px' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>UTM: </span>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{utm.zone}{utm.hemisphere} {utm.easting.toFixed(0)}E {utm.northing.toFixed(0)}N</span>
                          </div>

                          {/* WGS84 */}
                          <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>WGS84: </span>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{tp.latitude.toFixed(6)}° / {tp.longitude.toFixed(6)}°</span>
                          </div>

                          {/* Flugdaten 2x2 Grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Höhe</div>
                              <div style={{ fontSize: '16px', fontWeight: 600, color: '#3b82f6' }}>
                                {settings.altitudeUnit === 'feet' ? Math.round(tp.altitude * 3.28084) : Math.round(tp.altitude)} {settings.altitudeUnit === 'feet' ? 'ft' : 'm'}
                              </div>
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Speed</div>
                              <div style={{ fontSize: '16px', fontWeight: 600 }}>{tp.speed.toFixed(1)} km/h</div>
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Kurs</div>
                              <div style={{ fontSize: '16px', fontWeight: 600 }}>{Math.round(tp.heading)}°</div>
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Vario</div>
                              <div style={{ fontSize: '16px', fontWeight: 600, color: tp.vario > 0.1 ? '#22c55e' : tp.vario < -0.1 ? '#ef4444' : 'white' }}>
                                {tp.vario > 0 ? '+' : ''}{tp.vario.toFixed(1)} m/s
                              </div>
                            </div>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  )
                })}

                {/* Aktuelle Positions-Marker */}
                {pos && (() => {
                  // UTM Koordinaten berechnen
                  const utm = latLonToUTM(pos.latitude, pos.longitude)
                  const precision = settings.coordinateFormat === 'mgrs4' ? 4
                    : settings.coordinateFormat === 'mgrs5' ? 5
                    : settings.coordinateFormat === 'mgrs6' ? 6
                    : 5
                  const gridSquareEastBase = Math.floor(settings.utmBaseEasting / 100000) * 100000
                  const gridSquareNorthBase = Math.floor(settings.utmBaseNorthing / 100000) * 100000
                  const eastMeters = Math.round(utm.easting - gridSquareEastBase)
                  const northMeters = Math.round(utm.northing - gridSquareNorthBase)
                  const eastStr = eastMeters.toString().padStart(5, '0').substring(0, precision)
                  const northStr = northMeters.toString().padStart(5, '0').substring(0, precision)
                  const gridRef = `${eastStr} ${northStr}`

                  return (
                    <Marker
                      position={[pos.latitude, pos.longitude]}
                      icon={createBalloonIcon('small', 'pointer', pos.heading, member.color)}
                    >
                      <Popup
                        className="dark-trackpoint-popup"
                        autoPan={true}
                        autoPanPadding={[80, 80]}
                        keepInView={true}
                        maxWidth={400}
                      >
                        <div style={{
                          fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                          fontSize: '12px',
                          background: 'rgba(10, 15, 30, 0.98)',
                          color: 'white',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          margin: '-13px -20px -13px -20px',
                          padding: '20px 24px',
                          minWidth: '320px'
                        }}>
                          {/* Header Zeile */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '12px',
                            paddingBottom: '12px',
                            borderBottom: `1px solid ${member.color}50`
                          }}>
                            <div style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '50%',
                              background: member.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                                <ellipse cx="12" cy="8" rx="6" ry="7" />
                                <path d="M12 15 L8 22 L12 20 L16 22 Z" />
                              </svg>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Team Position</div>
                              <div style={{ fontSize: '16px', fontWeight: 700, color: member.color }}>{member.callsign}</div>
                              <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: '#22c55e20',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                marginTop: '2px'
                              }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
                                <span style={{ fontSize: '9px', color: '#22c55e', fontWeight: 600 }}>LIVE</span>
                              </div>
                            </div>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', flexShrink: 0 }}>
                              {settings.altitudeUnit === 'feet' ? Math.round(pos.altitude * 3.28084) : Math.round(pos.altitude)}{settings.altitudeUnit === 'feet' ? 'ft' : 'm'}
                            </div>
                          </div>

                          {/* Grid Reference */}
                          <div style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Grid ({precision}/{precision})</div>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b', letterSpacing: '2px' }}>{gridRef}</div>
                          </div>

                          {/* UTM */}
                          <div style={{ marginBottom: '4px' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>UTM: </span>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{utm.zone}{utm.hemisphere} {utm.easting.toFixed(0)}E {utm.northing.toFixed(0)}N</span>
                          </div>

                          {/* WGS84 */}
                          <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>WGS84: </span>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{pos.latitude.toFixed(6)}° / {pos.longitude.toFixed(6)}°</span>
                          </div>

                          {/* Flugdaten 2x2 Grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Höhe</div>
                              <div style={{ fontSize: '16px', fontWeight: 600, color: '#3b82f6' }}>
                                {settings.altitudeUnit === 'feet' ? Math.round(pos.altitude * 3.28084) : Math.round(pos.altitude)} {settings.altitudeUnit === 'feet' ? 'ft' : 'm'}
                              </div>
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Speed</div>
                              <div style={{ fontSize: '16px', fontWeight: 600 }}>{pos.speed.toFixed(1)} km/h</div>
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Kurs</div>
                              <div style={{ fontSize: '16px', fontWeight: 600 }}>{Math.round(pos.heading)}°</div>
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px' }}>
                              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Vario</div>
                              <div style={{ fontSize: '16px', fontWeight: 600, color: pos.vario > 0.1 ? '#22c55e' : pos.vario < -0.1 ? '#ef4444' : 'white' }}>
                                {pos.vario > 0 ? '+' : ''}{pos.vario.toFixed(1)} m/s
                              </div>
                            </div>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  )
                })()}
                {/* Callsign Label */}
                {pos && (
                  <Marker
                    position={[pos.latitude, pos.longitude]}
                    icon={L.divIcon({
                      className: 'team-callsign-label',
                      html: `<div style="
                        display: inline-block;
                        background: ${member.color};
                        color: white;
                        padding: 2px 8px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        white-space: nowrap;
                        text-align: center;
                        transform: translate(-50%, -32px);
                        box-shadow: 0 2px 4px rgba(0,0,0,0.4);
                        pointer-events: none;
                        border: 1px solid rgba(255,255,255,0.3);
                      ">${member.callsign}</div>`,
                      iconSize: [0, 0],
                      iconAnchor: [0, 0]
                    })}
                    interactive={false}
                  />
                )}
              </React.Fragment>
            )
          })}

        {/* PZ Zeichenmodus - temporäres Polygon während des Zeichnens */}
        {pzDrawMode && pzDrawPoints.length > 0 && (
          <>
            {/* Temporäre Linie/Polygon während des Zeichnens */}
            <Polyline
              positions={pzDrawPoints.map(p => [p.lat, p.lon] as [number, number])}
              pathOptions={{
                color: '#f59e0b',
                weight: 3,
                dashArray: '5, 5'
              }}
            />
            {/* Punkte als Marker */}
            {pzDrawPoints.map((point, index) => (
              <CircleMarker
                key={`pz-draw-${index}`}
                center={[point.lat, point.lon]}
                radius={6}
                pathOptions={{
                  color: '#f59e0b',
                  fillColor: index === 0 ? '#22c55e' : '#f59e0b',
                  fillOpacity: 1,
                  weight: 2
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  <span style={{ fontSize: '10px', fontWeight: 600 }}>
                    {index + 1}
                  </span>
                </Tooltip>
              </CircleMarker>
            ))}
            {/* Verbindung zum ersten Punkt wenn >= 3 Punkte (Polygon-Vorschau) */}
            {pzDrawPoints.length >= 3 && (
              <Polyline
                positions={[
                  [pzDrawPoints[pzDrawPoints.length - 1].lat, pzDrawPoints[pzDrawPoints.length - 1].lon],
                  [pzDrawPoints[0].lat, pzDrawPoints[0].lon]
                ]}
                pathOptions={{
                  color: '#22c55e',
                  weight: 2,
                  dashArray: '3, 6'
                }}
              />
            )}
          </>
        )}

        {/* Prohibited Zones (PZ) / Sperrgebiete */}
        {showProhibitedZones && prohibitedZones.map((pz) => {
          const pzColor = pz.color || settings.pzCircleColor || '#ef4444'
          const pzLabelBg = settings.pzLabelBackground || 'rgba(239, 68, 68, 0.95)'
          const pzLabelColor = settings.pzLabelColor || '#ffffff'
          const pzLabelSize = settings.pzLabelSize || 11
          // Individuelle fillOpacity hat Vorrang, sonst globale Einstellung
          const pzOpacity = pz.fillOpacity !== undefined ? pz.fillOpacity : (settings.pzCircleOpacity ?? 0.15)
          const pzDashed = settings.pzCircleDashed !== false
          const isPolygon = pz.type === 'polygon' && pz.polygon && pz.polygon.length >= 3
          const isClosed = pz.closed !== false  // Default: geschlossen (true)

          // Display-Koordinaten (transformiert wenn OZI-Karte aktiv)
          const displayCoord = getPzDisplayCoord(pz.id, pz.lat, pz.lon)
          const displayPolygon = isPolygon ? getPzPolygonDisplayCoords(pz.id, pz.polygon!) : []

          return (
            <React.Fragment key={pz.id}>
              {/* PZ als Polygon oder Polyline (aus PLT-Dateien) */}
              {isPolygon && isClosed && (
                <Polygon
                  positions={displayPolygon.map(p => [p.lat, p.lon] as [number, number])}
                  pathOptions={{
                    color: pzColor,
                    fillColor: pzColor,
                    fillOpacity: pzOpacity,
                    weight: 2,
                    dashArray: pzDashed ? '8, 4' : undefined
                  }}
                />
              )}
              {/* PZ als offene Linie (nicht geschlossen) */}
              {isPolygon && !isClosed && (
                <Polyline
                  positions={displayPolygon.map(p => [p.lat, p.lon] as [number, number])}
                  pathOptions={{
                    color: pzColor,
                    weight: 2,
                    dashArray: pzDashed ? '8, 4' : undefined
                  }}
                />
              )}
              {/* PZ als Kreis - NUR wenn Radius > 0 vorhanden */}
              {!isPolygon && pz.radius && pz.radius > 0 && (
                <Circle
                  center={[displayCoord.lat, displayCoord.lon]}
                  radius={pz.radius}
                  pathOptions={{
                    color: pzColor,
                    fillColor: pzColor,
                    fillOpacity: pzOpacity,
                    weight: 2,
                    dashArray: pzDashed ? '8, 4' : undefined
                  }}
                />
              )}
              {/* PZ Punkt-Marker mit Tooltip für UTM Koordinaten */}
              <CircleMarker
                center={[displayCoord.lat, displayCoord.lon]}
                radius={4}
                pathOptions={{
                  color: pzColor,
                  fillColor: '#fff',
                  fillOpacity: 0.9,
                  weight: 2
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  <div style={{ fontSize: '11px', lineHeight: '1.3', padding: '2px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '2px' }}>{pz.name}</div>
                    {(() => {
                      // Zeige Original-UTM-Koordinaten (nicht transformierte)
                      const utm = latLonToUTM(pz.lat, pz.lon)
                      return (
                        <>
                          <div><strong>E:</strong> {Math.round(utm.easting)}</div>
                          <div><strong>N:</strong> {Math.round(utm.northing)}</div>
                          <div style={{ fontSize: '9px', color: '#666' }}>Zone {utm.zone}{utm.hemisphere}</div>
                        </>
                      )
                    })()}
                    {pz.elevation && <div><strong>Höhe:</strong> {settings.pzAltitudeUnit === 'meters' ? Math.round(pz.elevation / 3.28084) + ' m' : pz.elevation + ' ft'}</div>}
                    {pz.radius && pz.radius > 0 && <div><strong>Radius:</strong> {pz.radius} m</div>}
                  </div>
                </Tooltip>
              </CircleMarker>
              {/* PZ Label unterhalb des Punktes */}
              <Marker
                position={[displayCoord.lat, displayCoord.lon]}
                icon={L.divIcon({
                  className: 'pz-label',
                  html: `<div style="
                    display: inline-block;
                    background: ${pzLabelBg};
                    color: ${pzLabelColor};
                    padding: 3px 6px;
                    border-radius: 4px;
                    font-size: ${pzLabelSize}px;
                    font-weight: 600;
                    border: 1px solid ${pzColor};
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    text-align: center;
                    transform: translateX(-50%);
                    white-space: nowrap;
                  ">${pz.name}${pz.elevation ? ` ${settings.pzAltitudeUnit === 'meters' ? Math.round(pz.elevation / 3.28084) + 'm' : pz.elevation + 'ft'}` : ''}</div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, -12]
                })}
                interactive={false}
              />
            </React.Fragment>
          )
        })}

        {/* Grid Overlay - deckt den gesamten sichtbaren Bereich ab */}
        {/* Verwendet globale Settings, auch für Competition Maps */}
        {settings.showGrid && (
          <GridOverlay
            gridSize={gridSize}
            utmZone={activeCompetitionMapFromStore?.utmZone || (settings.utmZone >= 1 && settings.utmZone <= 60 ? settings.utmZone : 33)}
            competitionBounds={activeCompetitionMapFromStore?.bounds || null}
            showLabels={settings.showGridLabels}
            lineColor={settings.gridLineColor || '#3b82f6'}
            lineWidth={settings.gridLineWidth || 1}
            lineOpacity={settings.gridLineOpacity || 0.6}
            lineDashed={settings.gridLineDashed !== false}
            labelColor={settings.gridLabelColor || '#1e40af'}
            labelSize={settings.gridLabelSize || 10}
          />
        )}

        {/* Competition Map Rahmen - zeigt die Grenzen des Wettkampfbereichs */}
        {activeCompetitionMapFromStore?.bounds && (
          <Rectangle
            bounds={[
              [activeCompetitionMapFromStore.bounds.south, activeCompetitionMapFromStore.bounds.west],
              [activeCompetitionMapFromStore.bounds.north, activeCompetitionMapFromStore.bounds.east]
            ]}
            pathOptions={{
              color: '#f59e0b',
              weight: 3,
              opacity: 0.9,
              fillOpacity: 0,
              dashArray: '10, 5'
            }}
          />
        )}
      </MapContainer>

      {/* Drop Marker Hover Popup */}
      {hoveredDropMarker && dropMarkerHoverPos && (() => {
        const marker = markers.find(m => m.id === hoveredDropMarker)
        if (!marker) return null

        const utm = latLonToUTM(marker.position.latitude, marker.position.longitude)
        const precision = settings.coordinateFormat === 'mgrs4' ? 4 :
                         settings.coordinateFormat === 'mgrs5' ? 5 : 6
        const eastingWithin100k = Math.round(utm.easting % 100000)
        const northingWithin100k = Math.round(utm.northing % 100000)
        const eastStr = eastingWithin100k.toString().padStart(5, '0').slice(0, precision)
        const northStr = northingWithin100k.toString().padStart(5, '0').slice(0, precision)
        const gridRef = `${eastStr} ${northStr}`

        return (
          <div
            style={{
              position: 'absolute',
              left: dropMarkerHoverPos.x,
              top: dropMarkerHoverPos.y - 10,
              transform: 'translate(-50%, -100%)',
              zIndex: 10000,
              pointerEvents: 'none',
              fontFamily: "'JetBrains Mono', 'Consolas', monospace",
              fontSize: '12px',
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              color: 'white',
              borderRadius: '12px',
              padding: '16px 20px',
              minWidth: '300px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
            }}
          >
            {/* Header Zeile */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
              paddingBottom: '12px',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)'
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '16px',
                fontWeight: 700,
                flexShrink: 0
              }}>
                {marker.number}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Marker Drop</div>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>{new Date(marker.timestamp).toLocaleTimeString('de-DE')}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{new Date(marker.timestamp).toLocaleDateString('de-DE')}</div>
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', flexShrink: 0 }}>
                {settings.altitudeUnit === 'feet' ? Math.round(marker.altitude * 3.28084) : Math.round(marker.altitude)}{settings.altitudeUnit === 'feet' ? 'ft' : 'm'}
              </div>
            </div>

            {/* Grid Reference */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Grid ({precision}/{precision})</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b', letterSpacing: '2px' }}>{gridRef}</div>
            </div>

            {/* UTM */}
            <div style={{ marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>UTM: </span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{utm.zone}{utm.hemisphere} {Math.round(utm.easting)}E {Math.round(utm.northing)}N</span>
            </div>

            {/* WGS84 */}
            <div>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>WGS84: </span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{marker.position.latitude.toFixed(6)}° / {marker.position.longitude.toFixed(6)}°</span>
            </div>

            {/* Notizen falls vorhanden */}
            {marker.notes && (
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
                {marker.notes}
              </div>
            )}

            {/* Pfeil nach unten */}
            <div style={{
              position: 'absolute',
              bottom: -8,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '8px solid rgba(10, 15, 30, 0.98)'
            }} />
          </div>
        )
      })()}

      {/* Power Lines Legende */}
      {showPowerLines && showPowerLinesLegend && (
        <PowerLinesLegend onClose={() => setShowPowerLinesLegend(false)} />
      )}

      {/* Offline Cache Stats */}

      {/* Wettkampfbereich Panel */}
      {showCompetitionArea && (
        <CompetitionAreaPanel onClose={() => setShowCompetitionArea(false)} />
      )}

      {/* Windrose Overlay */}
      {showWindRose && windLayers.length > 0 && (
        <WindRose
          windLayers={windLayers}
          windSourceFilter={windSourceFilter}
          windDirectionMode={settings.windDirectionMode}
          altitudeUnit={settings.altitudeUnit}
          onClose={() => setShowWindRose(false)}
        />
      )}

      {/* Messpunkte auf Karte anzeigen */}
      {measurePoints.length > 0 && (
        <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          {/* Die Polyline wird innerhalb MapContainer gerendert */}
        </div>
      )}

      {/* Drawing Controls Overlay */}
      {drawingMode !== 'none' && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(10, 15, 30, 0.97)',
          backdropFilter: 'blur(16px)',
          padding: '16px 24px',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-primary)'
          }}>
            {drawingMode === 'circle' && (drawingCenter ? 'Klicke für Radius oder drücke Abbrechen' : 'Klicke für Zentrum')}
            {drawingMode === 'line' && `${drawingPoints.length}/2 Punkte - Klicke ${drawingPoints.length === 0 ? 'Start' : 'Ende'}`}
            {drawingMode === 'freehand' && `${drawingPoints.length} Punkte - Klicke um fortzufahren`}
          </div>

          {drawingMode === 'freehand' && drawingPoints.length >= 3 && (
            <button
              className="btn btn-success"
              onClick={finishPolygon}
              style={{ fontSize: '13px' }}
            >
              Fertigstellen
            </button>
          )}

          <button
            className="btn btn-danger"
            onClick={cancelDrawing}
            style={{ fontSize: '13px' }}
          >
            Abbrechen
          </button>
        </div>
      )}

      {/* Tools und Navigation - unten rechts */}
      {(() => {
        const mapBtnStyle = (active: boolean, accent: string): React.CSSProperties => ({
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          width: '48px',
          height: '44px',
          padding: 0,
          border: 'none',
          borderRadius: '6px',
          background: active
            ? `linear-gradient(180deg, ${accent}25 0%, ${accent}10 100%)`
            : 'linear-gradient(180deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.95) 100%)',
          color: active ? accent : 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'all 0.15s',
          fontSize: '9px',
          fontWeight: 600,
          fontFamily: 'inherit',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          borderBottom: active
            ? `2px solid ${accent}`
            : '2px solid transparent',
          letterSpacing: '0.3px'
        })
        return (
          <div style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 4,
            zIndex: 1000
          }}>
            {/* Stoppuhr */}
            <button
              onClick={() => setShowStopwatch(!showStopwatch)}
              style={mapBtnStyle(showStopwatch, '#22c55e')}
              title="Stoppuhr"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2 2" />
                <path d="M9 2h6" />
                <path d="M12 2v2" />
              </svg>
              <span>Timer</span>
            </button>

            {/* Messwerkzeug */}
            <button
              onClick={() => setShowMeasureTool(!showMeasureTool)}
              style={mapBtnStyle(showMeasureTool, '#3b82f6')}
              title="Messwerkzeug (Shift+Klick)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 22L22 2" />
                <path d="M6 18l2-2" />
                <path d="M10 14l2-2" />
                <path d="M14 10l2-2" />
                <path d="M18 6l2-2" />
              </svg>
              <span>Mess</span>
            </button>

            {/* Kartentyp */}
            <button
              onClick={() => {
                const types: ('osm' | 'satellite' | 'hybrid')[] = ['osm', 'satellite', 'hybrid']
                const currentIndex = types.indexOf(mapType)
                const nextIndex = (currentIndex + 1) % types.length
                setMapType(types[nextIndex])
              }}
              style={mapBtnStyle(mapType !== 'osm', mapType === 'satellite' ? '#3b82f6' : '#8b5cf6')}
              title={`Kartentyp: ${mapType === 'osm' ? 'OpenStreetMap' : mapType === 'satellite' ? 'Topo' : 'Satellit'}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
              <span>{mapType === 'osm' ? 'OSM' : mapType === 'satellite' ? 'Topo' : 'SAT'}</span>
            </button>

            {/* Hochspannungsleitungen */}
            <button
              onClick={() => {
                const newState = !showPowerLines
                setShowPowerLines(newState)
                if (newState) setShowPowerLinesLegend(true)
              }}
              style={mapBtnStyle(showPowerLines, '#ef4444')}
              title={`Hochspannungsleitungen ${showPowerLines ? 'ausblenden' : 'anzeigen'}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span>HV</span>
            </button>

            {/* Wettkampfbereich */}
            <button
              onClick={() => setShowCompetitionArea(!showCompetitionArea)}
              style={mapBtnStyle(showCompetitionArea, '#8b5cf6')}
              title="Wettkampfbereich für Offline-Karten definieren"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 3v18" />
              </svg>
              <span>Area</span>
            </button>

            {/* UTM-Ansicht Button entfernt - Grid wird jetzt direkt über Competition Map angezeigt */}

            {/* OZI Karten-Button entfernt - Kartenverwaltung jetzt über Meisterschaften */}

            {/* Zurück zur Area - erscheint wenn zu weit von Competition Map entfernt */}
            {isOutsideCompetitionArea && activeCompetitionMapFromStore && (
              <button
                onClick={flyToCompetitionArea}
                title="Zurück zum Wettkampfbereich"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0 12px',
                  height: '44px',
                  border: 'none',
                  borderRadius: '6px',
                  background: 'linear-gradient(180deg, rgba(245,158,11,0.9) 0%, rgba(217,119,6,0.9) 100%)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Zur Area
              </button>
            )}

            {/* Zum Ballon */}
            {!followBalloon && gpsData && (
              <button
                onClick={() => setFollowBalloon(true)}
                title="Zur Ballonposition springen"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0 12px',
                  height: '44px',
                  border: 'none',
                  borderRadius: '6px',
                  background: 'linear-gradient(180deg, rgba(34,197,94,0.9) 0%, rgba(22,163,74,0.9) 100%)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                Zum Ballon
              </button>
            )}
          </div>
        )
      })()}



      {/* Task Edit Panel */}
      {viewingTask && (
        <TaskEditPanel
          task={viewingTask}
          isOpen={true}
          onClose={() => setViewingTaskId(null)}
        />
      )}

      {/* Karten Panel entfernt - Kartenverwaltung jetzt über Meisterschaften */}

      {/* Flight Winds Panel */}
      <FlightWindsPanel
        isOpen={showWindsPanel}
        onClose={() => setShowWindsPanel(false)}
        selectedWindLayer={selectedWindLayer}
        onSelectWindLayer={setSelectedWindLayer}
      />

      {/* Marker Settings Panel */}
      <MarkerSettingsPanel
        isOpen={showMarkerSettings}
        onClose={() => setShowMarkerSettings(false)}
      />

      {/* Stoppuhr */}
      <Stopwatch
        isOpen={showStopwatch}
        onClose={() => setShowStopwatch(false)}
      />

      {/* Messwerkzeug */}
      <MeasureTool
        isOpen={showMeasureTool}
        onClose={() => setShowMeasureTool(false)}
        points={measurePoints}
        onClear={() => {
          setMeasurePoints([])
          setMeasureAreaCompleted(false)
        }}
        mode={measureMode}
        onModeChange={(newMode) => {
          setMeasureMode(newMode)
          setMeasureAreaCompleted(false)
        }}
        areaCompleted={measureAreaCompleted}
        onAreaComplete={() => setMeasureAreaCompleted(true)}
        color={settings.measureColor || '#22c55e'}
        onColorChange={(newColor) => updateSettings({ measureColor: newColor })}
      />
    </div>
  )
}
