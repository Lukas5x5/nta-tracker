import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTrackerStore, type PilotPosition, type PilotTask } from '../stores/trackerStore'
import { GroundWindDialog } from './GroundWindDialog'

// WGS84 zu UTM Konvertierung
function latLngToUTM(lat: number, lng: number): { zone: number; easting: number; northing: number; letter: string } {
  const zone = Math.floor((lng + 180) / 6) + 1
  const letter = lat >= 0 ? 'N' : 'S'

  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996

  const e = Math.sqrt(2 * f - f * f)
  const e2 = e * e / (1 - e * e)

  const latRad = lat * Math.PI / 180
  const lngRad = lng * Math.PI / 180
  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180

  const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad))
  const T = Math.tan(latRad) * Math.tan(latRad)
  const C = e2 * Math.cos(latRad) * Math.cos(latRad)
  const A = Math.cos(latRad) * (lngRad - lng0)

  const M = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64) * latRad
    - (3 * e * e / 8 + 3 * e * e * e * e / 32) * Math.sin(2 * latRad)
    + (15 * e * e * e * e / 256) * Math.sin(4 * latRad))

  const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e2) * A * A * A * A * A / 120) + 500000

  let northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * e2) * A * A * A * A * A * A / 720))

  if (lat < 0) {
    northing += 10000000
  }

  return { zone, easting: Math.round(easting), northing: Math.round(northing), letter }
}

function formatWGS84(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`
}

function formatUTM(lat: number, lng: number): string {
  const utm = latLngToUTM(lat, lng)
  return `${utm.zone}${utm.letter} ${utm.easting} ${utm.northing}`
}

export function TrackerMap() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const taskLayersRef = useRef<L.LayerGroup | null>(null)
  const navLineRef = useRef<L.Polyline | null>(null)
  const navLineBorderRef = useRef<L.Polyline | null>(null)
  const myLocationMarkerRef = useRef<L.Marker | null>(null)
  const myLocationCircleRef = useRef<L.Circle | null>(null)
  const initialFitDoneRef = useRef(false)
  const [windDialogTask, setWindDialogTask] = useState<PilotTask | null>(null)

  const { pilots, selectedPilot, selectPilot, pilotTasks } = useTrackerStore()

  // Globale Callbacks für Leaflet-Popup-Buttons registrieren
  useEffect(() => {
    (window as any).__ntaNavigateToGoal = (lat: number, lng: number) => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, '_blank')
    };
    (window as any).__ntaReportWind = (taskId: string) => {
      const task = useTrackerStore.getState().pilotTasks.find(t => t.id === taskId)
      if (task) setWindDialogTask(task)
    }
    return () => {
      delete (window as any).__ntaNavigateToGoal
      delete (window as any).__ntaReportWind
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, {
      center: [47.5, 14.0], // Austria center
      zoom: 8,
      zoomControl: true,
      attributionControl: false
    })

    // Hide broken tiles (make them transparent instead of black)
    const handleTileError = (e: L.TileErrorEvent) => {
      if (e.tile) {
        e.tile.style.display = 'none'
      }
    }

    // Tile Layers
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: '© OSM'
    })
    osmLayer.on('tileerror', handleTileError)

    const satelliteLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      maxNativeZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: '© Google'
    })
    satelliteLayer.on('tileerror', handleTileError)

    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      maxNativeZoom: 15,
      attribution: '© OpenTopoMap'
    })
    topoLayer.on('tileerror', handleTileError)

    // Default Layer
    osmLayer.addTo(map)

    // Layer Control
    const baseLayers: Record<string, L.TileLayer> = {
      'Karte': osmLayer,
      'Satellit': satelliteLayer,
      'Topo': topoLayer
    }
    L.control.layers(baseLayers, {}, { position: 'topright', collapsed: false }).addTo(map)

    // Attribution
    L.control.attribution({
      position: 'bottomright',
      prefix: ''
    }).addTo(map)

    mapInstanceRef.current = map

    // GPS-Position verfolgen
    if ('geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          const accuracy = pos.coords.accuracy

          if (myLocationMarkerRef.current) {
            myLocationMarkerRef.current.setLatLng([lat, lng])
            myLocationCircleRef.current?.setLatLng([lat, lng])
            myLocationCircleRef.current?.setRadius(accuracy)
          } else {
            // Genauigkeitskreis
            myLocationCircleRef.current = L.circle([lat, lng], {
              radius: accuracy,
              color: '#4285f4',
              fillColor: '#4285f4',
              fillOpacity: 0.1,
              weight: 1
            }).addTo(map)

            // Blauer Punkt
            const myIcon = L.divIcon({
              html: `<div style="
                width: 16px;
                height: 16px;
                background: #4285f4;
                border: 3px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 8px rgba(66,133,244,0.6);
              "></div>`,
              className: '',
              iconSize: [16, 16],
              iconAnchor: [8, 8]
            })
            myLocationMarkerRef.current = L.marker([lat, lng], { icon: myIcon, zIndexOffset: 2000 })
              .bindPopup('Meine Position')
              .addTo(map)
          }
        },
        (err) => {
          console.log('[Map] GPS error:', err.message)
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      )

      return () => {
        navigator.geolocation.clearWatch(watchId)
        map.remove()
        mapInstanceRef.current = null
      }
    }

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Update markers when pilots change
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    const currentMemberIds = new Set(pilots.map(p => p.memberId))

    // Remove markers for pilots that are no longer present
    markersRef.current.forEach((marker, memberId) => {
      if (!currentMemberIds.has(memberId)) {
        marker.remove()
        markersRef.current.delete(memberId)
      }
    })

    // Update or create markers (nur für Piloten mit gültiger Position)
    pilots.forEach(pilot => {
      const hasValidPosition = pilot.latitude !== 0 && pilot.longitude !== 0
      const existing = markersRef.current.get(pilot.memberId)

      if (existing) {
        if (hasValidPosition) {
          // Update position
          existing.setLatLng([pilot.latitude, pilot.longitude])
          // Update icon
          const newIcon = createPilotIcon(pilot)
          existing.setIcon(newIcon)
        } else {
          // Entferne Marker wenn Position ungültig
          existing.remove()
          markersRef.current.delete(pilot.memberId)
        }
      } else if (hasValidPosition) {
        // Create new marker nur wenn Position gültig
        const marker = createPilotMarker(pilot, map, selectPilot)
        markersRef.current.set(pilot.memberId, marker)
      }
    })

    // Fit bounds only once on initial load
    if (!initialFitDoneRef.current && pilots.length > 0) {
      const pilotsWithPosition = pilots.filter(p => p.latitude !== 0 && p.longitude !== 0)
      if (pilotsWithPosition.length > 0) {
        const bounds = L.latLngBounds(pilotsWithPosition.map(p => [p.latitude, p.longitude]))
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 })
          initialFitDoneRef.current = true
        }
      }
    }
  }, [pilots, selectPilot])

  // Center on selected pilot (only when selection changes, not on position updates)
  useEffect(() => {
    if (!selectedPilot || !mapInstanceRef.current) return

    const pilot = pilots.find(p => p.memberId === selectedPilot)
    if (pilot && pilot.latitude !== 0 && pilot.longitude !== 0) {
      mapInstanceRef.current.setView([pilot.latitude, pilot.longitude], 14, { animate: true })
    }
  }, [selectedPilot])

  // Draw task goals on map when pilotTasks change
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    console.log('[Map] Drawing tasks:', pilotTasks.length, 'tasks')

    // Entferne alle alten Task-Layer von der Karte
    if (taskLayersRef.current) {
      taskLayersRef.current.clearLayers()
      map.removeLayer(taskLayersRef.current)
      taskLayersRef.current = null
    }

    if (pilotTasks.length === 0) return

    // Neue LayerGroup erstellen und zur Map hinzufügen
    taskLayersRef.current = L.layerGroup().addTo(map)

    // Get pilot color (aus markersRef, nicht aus pilots um Dependency zu vermeiden)
    const color = '#3b82f6'

    // Sammle alle Goal-Positionen für fitBounds
    const goalPositions: [number, number][] = []
    let totalGoals = 0

    // Draw goals for each task
    pilotTasks.forEach(task => {
      console.log('[Map] Task:', task.name, 'Type:', task.type, 'Goals:', task.goals.length, 'TaskNumber:', task.taskNumber)

      task.goals.forEach((goal, idx) => {
        console.log('[Map] Goal', idx + 1, 'position:', goal.position, 'name:', goal.name)

        if (!goal.position?.latitude || !goal.position?.longitude) {
          console.log('[Map] Skipping goal - no valid position')
          return
        }

        const lat = goal.position.latitude
        const lng = goal.position.longitude
        const radius = goal.radius || 100

        console.log('[Map] Adding goal at:', lat, lng, 'radius:', radius)

        goalPositions.push([lat, lng])
        totalGoals++

        // MMA circle in rot (nur wenn mmaRadius > 0), sonst nur ein Punkt
        if (task.mmaRadius && task.mmaRadius > 0) {
          const mmaCircle = L.circle([lat, lng], {
            radius: task.mmaRadius,
            color: '#ff0000',
            fillColor: '#ff0000',
            fillOpacity: 0.15,
            weight: 3
          })
          taskLayersRef.current!.addLayer(mmaCircle)
        } else {
          // Kein MMA - kleinen roten Punkt anzeigen
          const dot = L.circleMarker([lat, lng], {
            radius: 6,
            color: '#ff0000',
            fillColor: '#ff0000',
            fillOpacity: 1,
            weight: 2
          })
          taskLayersRef.current!.addLayer(dot)
        }

        // Task Rings
        if (task.rings && task.rings.length > 0) {
          const ringColors = ['#ff0000', '#ff8800', '#ffff00', '#00ff00']
          task.rings.forEach((ringRadius, ringIdx) => {
            if (ringRadius > 0) {
              const ringCircle = L.circle([lat, lng], {
                radius: ringRadius,
                color: ringColors[ringIdx % ringColors.length],
                fillColor: 'transparent',
                fillOpacity: 0,
                weight: 2,
                dashArray: '10, 8'
              })
              taskLayersRef.current!.addLayer(ringCircle)
            }
          })
        }

        // Goal marker - zeigt Task-Name
        const markerIcon = L.divIcon({
          html: `
            <div style="
              background: ${color};
              border: 2px solid #fff;
              border-radius: 4px;
              padding: 3px 6px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.5);
              white-space: nowrap;
              position: absolute;
              transform: translate(-50%, -100%);
              margin-top: -8px;
            ">
              <span style="
                color: #fff;
                font-size: 11px;
                font-weight: 700;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              ">${task.name}</span>
            </div>
          `,
          className: 'task-goal-marker',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        })

        const marker = L.marker([lat, lng], { icon: markerIcon, zIndexOffset: 1000 })
          .bindPopup(`
            <div style="
              background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
              border-radius: 8px;
              padding: 12px;
              color: #fff;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              min-width: 220px;
            ">
              <div style="font-weight: 700; margin-bottom: 8px; font-size: 14px;">${task.taskNumber || ''} ${task.name}</div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.7);">
                <div style="margin-bottom: 6px;">${goal.name || `Goal ${idx + 1}`}</div>
                <div style="font-family: monospace; font-size: 10px; color: rgba(255,255,255,0.5); line-height: 1.6;">
                  <div>Radius: ${radius}m</div>
                  <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);">
                    WGS84: ${formatWGS84(lat, lng)}
                  </div>
                  <div>UTM: ${formatUTM(lat, lng)}</div>
                </div>
              </div>
              <div style="display: flex; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                <button onclick="window.__ntaNavigateToGoal(${lat}, ${lng})" style="
                  flex: 1;
                  padding: 8px;
                  background: rgba(34, 197, 94, 0.2);
                  border: 1px solid rgba(34, 197, 94, 0.4);
                  border-radius: 6px;
                  color: #22c55e;
                  font-size: 11px;
                  font-weight: 600;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 4px;
                ">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                  Navigation
                </button>
                <button onclick="window.__ntaReportWind('${task.id}')" style="
                  flex: 1;
                  padding: 8px;
                  background: rgba(59, 130, 246, 0.2);
                  border: 1px solid rgba(59, 130, 246, 0.4);
                  border-radius: 6px;
                  color: #3b82f6;
                  font-size: 11px;
                  font-weight: 600;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 4px;
                ">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
                  </svg>
                  Wind
                </button>
              </div>
            </div>
          `, { className: 'task-popup' })
        taskLayersRef.current!.addLayer(marker)
      })
    })

    console.log('[Map] Total goals drawn:', totalGoals)
  }, [pilotTasks, selectedPilot])

  // Heading Line: Linie vom ausgewählten Piloten in aktuelle Flugrichtung
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    // Alte Linien entfernen
    if (navLineRef.current) {
      map.removeLayer(navLineRef.current)
      navLineRef.current = null
    }
    if (navLineBorderRef.current) {
      map.removeLayer(navLineBorderRef.current)
      navLineBorderRef.current = null
    }

    if (!selectedPilot) return

    // Piloten-Position finden
    const pilot = pilots.find(p => p.memberId === selectedPilot)
    if (!pilot || pilot.latitude === 0 || pilot.longitude === 0) return

    // Endpunkt berechnen: 500m in Heading-Richtung
    const headingRad = (pilot.heading * Math.PI) / 180
    const distanceM = 500
    const earthRadius = 6371000
    const lat1 = (pilot.latitude * Math.PI) / 180
    const lng1 = (pilot.longitude * Math.PI) / 180
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceM / earthRadius) +
      Math.cos(lat1) * Math.sin(distanceM / earthRadius) * Math.cos(headingRad)
    )
    const lng2 = lng1 + Math.atan2(
      Math.sin(headingRad) * Math.sin(distanceM / earthRadius) * Math.cos(lat1),
      Math.cos(distanceM / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
    )
    const endLat = (lat2 * 180) / Math.PI
    const endLng = (lng2 * 180) / Math.PI

    const positions: L.LatLngExpression[] = [
      [pilot.latitude, pilot.longitude],
      [endLat, endLng]
    ]

    // Schwarzer Rand für Kontrast
    navLineBorderRef.current = L.polyline(positions, {
      color: '#000000',
      weight: 6,
      opacity: 0.4,
      interactive: false,
    }).addTo(map)

    // Gelbe Hauptlinie (Kurs-Richtung)
    navLineRef.current = L.polyline(positions, {
      color: '#facc15',
      weight: 3,
      opacity: 0.9,
      interactive: false,
    }).addTo(map)
  }, [selectedPilot, pilots])

  return (
    <>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {windDialogTask && (
        <GroundWindDialog
          task={windDialogTask}
          onClose={() => setWindDialogTask(null)}
        />
      )}
    </>
  )
}

function createPilotIcon(pilot: PilotPosition): L.DivIcon {
  const iconHtml = `
    <div style="
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    ">
      <div style="
        width: 32px;
        height: 32px;
        background: ${pilot.color};
        border: 3px solid #fff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        opacity: ${pilot.isOnline ? 1 : 0.5};
      ">
        <span style="
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        ">${pilot.callsign.substring(0, 3)}</span>
      </div>
      <div style="
        position: absolute;
        top: -8px;
        left: 50%;
        transform: translateX(-50%) rotate(${pilot.heading}deg);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 10px solid ${pilot.color};
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
      "></div>
    </div>
  `

  return L.divIcon({
    html: iconHtml,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20]
  })
}

function createPilotMarker(pilot: PilotPosition, map: L.Map, onSelect: (memberId: string) => void): L.Marker {
  const icon = createPilotIcon(pilot)

  const marker = L.marker([pilot.latitude, pilot.longitude], { icon })
    .addTo(map)

  marker.on('click', () => {
    onSelect(pilot.memberId)
  })

  return marker
}

