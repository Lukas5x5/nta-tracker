import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTrackerStore, type PilotPosition, type PilotTask } from '../stores/trackerStore'

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
  const myLocationMarkerRef = useRef<L.Marker | null>(null)
  const myLocationCircleRef = useRef<L.Circle | null>(null)
  const initialFitDoneRef = useRef(false)

  const { pilots, selectedPilot, selectPilot, pilotTasks } = useTrackerStore()

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, {
      center: [47.5, 14.0], // Austria center
      zoom: 8,
      zoomControl: true,
      attributionControl: false
    })

    // Add tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map)

    // Attribution (klein unten rechts)
    L.control.attribution({
      position: 'bottomright',
      prefix: ''
    }).addAttribution('© OSM').addTo(map)

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
          // Update popup content
          existing.setPopupContent(createPopupContent(pilot))
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
      const marker = markersRef.current.get(selectedPilot)
      if (marker) {
        marker.openPopup()
      }
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
              min-width: 200px;
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
            </div>
          `)
        taskLayersRef.current!.addLayer(marker)
      })
    })

    console.log('[Map] Total goals drawn:', totalGoals)
  }, [pilotTasks, selectedPilot])

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
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
    .bindPopup(createPopupContent(pilot), {
      className: 'pilot-popup-container'
    })

  marker.on('click', () => {
    onSelect(pilot.memberId)
  })

  return marker
}

function createPopupContent(pilot: PilotPosition): string {
  const altFt = Math.round(pilot.altitude * 3.28084)
  const speedKmh = Math.round(pilot.speed * 3.6)
  const varioMs = pilot.vario.toFixed(1)
  const varioColor = pilot.vario > 0.3 ? '#22c55e' : pilot.vario < -0.3 ? '#ef4444' : 'rgba(255,255,255,0.7)'
  const timeAgo = getTimeAgo(pilot.timestamp)

  return `
    <div style="
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      border-radius: 8px;
      padding: 12px;
      min-width: 180px;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      ">
        <div style="
          width: 24px;
          height: 24px;
          background: ${pilot.color};
          border-radius: 50%;
          border: 2px solid #fff;
        "></div>
        <div style="font-size: 14px; font-weight: 700;">${pilot.callsign}</div>
        <div style="
          margin-left: auto;
          width: 8px;
          height: 8px;
          background: ${pilot.isOnline ? '#22c55e' : '#6b7280'};
          border-radius: 50%;
          box-shadow: ${pilot.isOnline ? '0 0 6px #22c55e' : 'none'};
        "></div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px;">
        <div style="display: flex; justify-content: space-between;">
          <span style="color: rgba(255,255,255,0.5);">Höhe</span>
          <span style="font-weight: 600; font-family: monospace;">${altFt} ft</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: rgba(255,255,255,0.5);">Kurs</span>
          <span style="font-weight: 600; font-family: monospace;">${Math.round(pilot.heading)}°</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: rgba(255,255,255,0.5);">Speed</span>
          <span style="font-weight: 600; font-family: monospace;">${speedKmh} km/h</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: rgba(255,255,255,0.5);">Vario</span>
          <span style="font-weight: 600; font-family: monospace; color: ${varioColor};">${pilot.vario > 0 ? '+' : ''}${varioMs} m/s</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          <span style="color: rgba(255,255,255,0.3); font-size: 10px;">Zuletzt</span>
          <span style="color: rgba(255,255,255,0.5); font-size: 10px;">${timeAgo}</span>
        </div>
      </div>
    </div>
  `
}

function getTimeAgo(timestamp: Date): string {
  const diff = Date.now() - timestamp.getTime()
  const seconds = Math.floor(diff / 1000)

  if (seconds < 60) return 'gerade eben'
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} h`
  return `vor ${Math.floor(seconds / 86400)} Tagen`
}
