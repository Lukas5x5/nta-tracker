import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

interface PowerLine {
  id: number
  voltage?: string
  coords: [number, number][]
}

interface WindTurbine {
  id: number
  lat: number
  lon: number
  height?: number
  power?: string
  name?: string
}

interface PowerLinesLayerProps {
  visible: boolean
  onLegendToggle?: (show: boolean) => void
}

// Legende für Power Lines und Windräder
export function PowerLinesLegend({ onClose }: { onClose: () => void }) {
  const [position, setPosition] = useState({ x: -1, y: 60 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

  // Initialize position from right side
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (!initialized) {
      setPosition({ x: window.innerWidth - 260, y: 60 })
      setInitialized(true)
    }
  }, [initialized])

  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!dragRef.current) return
      const dx = clientX - dragRef.current.startX
      const dy = clientY - dragRef.current.startY
      setPosition({
        x: Math.max(0, dragRef.current.startPosX + dx),
        y: Math.max(0, dragRef.current.startPosY + dy)
      })
    }
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) handleMove(touch.clientX, touch.clientY)
    }
    const handleEnd = () => { setIsDragging(false); dragRef.current = null }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging])

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    e.preventDefault()
    setIsDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: position.x, startPosY: position.y }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    const touch = e.touches[0]
    if (!touch) return
    e.stopPropagation()
    setIsDragging(true)
    dragRef.current = { startX: touch.clientX, startY: touch.clientY, startPosX: position.x, startPosY: position.y }
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      style={{
      position: 'fixed',
      left: `${position.x}px`,
      top: `${position.y}px`,
      background: 'rgba(15, 23, 42, 0.95)',
      borderRadius: '12px',
      padding: '12px 16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.1)',
      zIndex: 1000,
      minWidth: '200px',
      cursor: isDragging ? 'grabbing' : 'grab',
      userSelect: 'none'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>
          Luftfahrthindernisse
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px',
            lineHeight: 1
          }}
        >
          ×
        </button>
      </div>

      {/* Stromleitungen */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginBottom: '6px', fontWeight: 500 }}>
          Stromleitungen
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <LegendItem color="#ff0000" weight={4} label="380 kV+" />
          <LegendItem color="#ff3300" weight={3} label="220 kV" />
          <LegendItem color="#ff6600" weight={2.5} label="110 kV" />
          <LegendItem color="#ffaa00" weight={2} label="20 kV (Mittelspannung)" />
          <LegendItem color="#ffcc00" weight={1.5} label="Niederspannung" />
        </div>
      </div>

      {/* Windräder */}
      <div style={{
        paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginBottom: '6px', fontWeight: 500 }}>
          Windkraftanlagen
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px'
          }}>
            🌀
          </div>
          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '12px' }}>
            Windrad (Hover für Details)
          </span>
        </div>
      </div>

      <div style={{
        marginTop: '10px',
        paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.5)'
      }}>
        Daten: OpenStreetMap
      </div>
    </div>
  )
}

function LegendItem({ color, weight, label }: { color: string; weight: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{
        width: '30px',
        height: `${Math.max(weight, 2)}px`,
        background: color,
        borderRadius: '1px',
        flexShrink: 0
      }} />
      <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '12px' }}>
        {label}
      </span>
    </div>
  )
}

export function PowerLinesLayer({ visible, onLegendToggle }: PowerLinesLayerProps) {
  const map = useMap()
  const [powerLines, setPowerLines] = useState<PowerLine[]>([])
  const [windTurbines, setWindTurbines] = useState<WindTurbine[]>([])
  const [layerGroup] = useState(() => L.layerGroup())
  const lastLoadedBoundsRef = useRef<L.LatLngBounds | null>(null)
  const loadingRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loading, setLoading] = useState(false)

  // Prüfe ob der aktuelle Kartenbereich noch im bereits geladenen Bereich liegt
  const isWithinLoadedBounds = (currentBounds: L.LatLngBounds): boolean => {
    if (!lastLoadedBoundsRef.current) return false
    return lastLoadedBoundsRef.current.contains(currentBounds)
  }

  // Lade Power Lines und Windräder wenn sichtbar
  useEffect(() => {
    if (!visible) {
      layerGroup.clearLayers()
      lastLoadedBoundsRef.current = null
      return
    }

    const loadData = async (isRetry = false) => {
      // Verhindere parallele Anfragen
      if (loadingRef.current) return

      const bounds = map.getBounds()
      const zoom = map.getZoom()

      // Nur laden bei Zoom >= 10 (sonst zu viele Daten)
      if (zoom < 10) {
        layerGroup.clearLayers()
        lastLoadedBoundsRef.current = null
        return
      }

      // Nicht neu laden wenn aktueller Bereich noch in den geladenen Bounds liegt
      if (!isRetry && isWithinLoadedBounds(bounds)) return

      // Lade einen größeren Bereich (50% Puffer) damit bei kleinem Pan nicht sofort nachgeladen wird
      const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.5
      const lngPad = (bounds.getEast() - bounds.getWest()) * 0.5
      const paddedBounds = L.latLngBounds(
        [bounds.getSouth() - latPad, bounds.getWest() - lngPad],
        [bounds.getNorth() + latPad, bounds.getEast() + lngPad]
      )

      loadingRef.current = true
      setLoading(true)

      try {
        // Overpass API Query für Stromleitungen UND Windräder
        const query = `
          [out:json][timeout:30];
          (
            way["power"="line"]["voltage"](${paddedBounds.getSouth()},${paddedBounds.getWest()},${paddedBounds.getNorth()},${paddedBounds.getEast()});
            node["power"="generator"]["generator:source"="wind"](${paddedBounds.getSouth()},${paddedBounds.getWest()},${paddedBounds.getNorth()},${paddedBounds.getEast()});
            way["power"="generator"]["generator:source"="wind"](${paddedBounds.getSouth()},${paddedBounds.getWest()},${paddedBounds.getNorth()},${paddedBounds.getEast()});
          );
          out body;
          >;
          out skel qt;
        `

        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })

        if (response.status === 429) {
          // Too Many Requests - warte 15 Sekunden und versuche erneut
          console.warn('Overpass API rate limit reached, retry in 15s...')
          loadingRef.current = false
          setLoading(false)
          retryTimerRef.current = setTimeout(() => loadData(true), 15000)
          return
        }

        if (!response.ok) throw new Error('Overpass API error')

        const data = await response.json()

        // Merke die geladenen Bounds
        lastLoadedBoundsRef.current = paddedBounds

        // Nodes Map erstellen (für Way-Koordinaten und Windräder)
        const nodes = new Map<number, [number, number]>()
        const turbines: WindTurbine[] = []

        data.elements.forEach((el: any) => {
          if (el.type === 'node') {
            nodes.set(el.id, [el.lat, el.lon])

            // Windrad als Node
            if (el.tags?.power === 'generator' && el.tags?.['generator:source'] === 'wind') {
              turbines.push({
                id: el.id,
                lat: el.lat,
                lon: el.lon,
                height: el.tags?.height ? parseFloat(el.tags.height) : undefined,
                power: el.tags?.['generator:output:electricity'],
                name: el.tags?.name
              })
            }
          }
        })

        // Ways zu PowerLines konvertieren und Windpark-Ways verarbeiten
        const lines: PowerLine[] = []
        data.elements.forEach((el: any) => {
          if (el.type === 'way' && el.nodes) {
            // Windpark als Way (Zentroid berechnen)
            if (el.tags?.power === 'generator' && el.tags?.['generator:source'] === 'wind') {
              const coords: [number, number][] = []
              el.nodes.forEach((nodeId: number) => {
                const coord = nodes.get(nodeId)
                if (coord) coords.push(coord)
              })
              if (coords.length > 0) {
                const avgLat = coords.reduce((sum, c) => sum + c[0], 0) / coords.length
                const avgLon = coords.reduce((sum, c) => sum + c[1], 0) / coords.length
                turbines.push({
                  id: el.id,
                  lat: avgLat,
                  lon: avgLon,
                  height: el.tags?.height ? parseFloat(el.tags.height) : undefined,
                  power: el.tags?.['generator:output:electricity'],
                  name: el.tags?.name
                })
              }
            } else if (el.tags?.power === 'line') {
              const coords: [number, number][] = []
              el.nodes.forEach((nodeId: number) => {
                const coord = nodes.get(nodeId)
                if (coord) coords.push(coord)
              })
              if (coords.length >= 2) {
                lines.push({
                  id: el.id,
                  voltage: el.tags?.voltage,
                  coords
                })
              }
            }
          }
        })

        setPowerLines(lines)
        setWindTurbines(turbines)
      } catch (error) {
        console.error('Error loading power infrastructure:', error)
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    }

    // Debounced Load - wartet 800ms nach letzter Kartenbewegung
    const debouncedLoad = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => loadData(), 800)
    }

    // Initiales Laden
    loadData()

    // Event Handler für Kartenänderungen (debounced)
    map.on('moveend', debouncedLoad)

    return () => {
      map.off('moveend', debouncedLoad)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [visible, map, layerGroup])

  // Zeichne Power Lines auf der Karte
  useEffect(() => {
    layerGroup.clearLayers()

    if (!visible) return

    powerLines.forEach(line => {
      // Farbe basierend auf Spannung
      let color = '#ff6600' // Default orange
      let weight = 2

      if (line.voltage) {
        const voltage = parseInt(line.voltage)
        if (voltage >= 380000) {
          color = '#ff0000' // Rot für 380kV+
          weight = 4
        } else if (voltage >= 220000) {
          color = '#ff3300' // Orange-Rot für 220kV
          weight = 3
        } else if (voltage >= 110000) {
          color = '#ff6600' // Orange für 110kV
          weight = 2.5
        } else if (voltage >= 20000) {
          color = '#ffaa00' // Gelb-Orange für Mittelspannung
          weight = 2
        } else {
          color = '#ffcc00' // Gelb für Niederspannung
          weight = 1.5
        }
      }

      const polyline = L.polyline(line.coords, {
        color,
        weight,
        opacity: 0.9,
        dashArray: undefined
      })

      // Tooltip mit Spannung
      if (line.voltage) {
        const voltageKV = Math.round(parseInt(line.voltage) / 1000)
        polyline.bindTooltip(`${voltageKV} kV`, { sticky: true })
      }

      layerGroup.addLayer(polyline)
    })

    // Windräder zeichnen
    windTurbines.forEach(turbine => {
      // Custom Icon für Windrad
      const windIcon = L.divIcon({
        className: 'wind-turbine-icon',
        html: `<div style="
          font-size: 24px;
          text-shadow: 0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5);
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5));
        ">🌀</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })

      const marker = L.marker([turbine.lat, turbine.lon], { icon: windIcon })

      // Tooltip mit Details
      let tooltipContent = '<b>Windkraftanlage</b>'
      if (turbine.name) {
        tooltipContent = `<b>${turbine.name}</b>`
      }
      if (turbine.height) {
        tooltipContent += `<br>Höhe: ${turbine.height} m`
      }
      if (turbine.power) {
        tooltipContent += `<br>Leistung: ${turbine.power}`
      }

      marker.bindTooltip(tooltipContent, {
        direction: 'top',
        offset: [0, -10]
      })

      layerGroup.addLayer(marker)
    })
  }, [powerLines, windTurbines, visible, layerGroup])

  // Layer zur Karte hinzufügen/entfernen
  useEffect(() => {
    if (visible) {
      layerGroup.addTo(map)
    } else {
      layerGroup.remove()
    }

    return () => {
      layerGroup.remove()
    }
  }, [visible, map, layerGroup])

  // Loading Indicator anzeigen
  useEffect(() => {
    if (loading && visible) {
      // Optional: Loading indicator könnte hier angezeigt werden
    }
  }, [loading, visible])

  return null
}
