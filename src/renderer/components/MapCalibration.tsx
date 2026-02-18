import React, { useState, useEffect, useRef } from 'react'
import L from 'leaflet'

interface CalibrationPoint {
  id: string
  pixelX: number
  pixelY: number
  lat: number
  lon: number
}

interface MapCalibrationProps {
  mapId: string
  mapName: string
  imageWidth: number
  imageHeight: number
  imageDataUrl: string
  leafletMap: L.Map
  onClose: () => void
  onSave: (points: CalibrationPoint[]) => void
}

// Berechne affine Transformation aus Kalibrierungspunkten
function calculateAffineTransform(points: CalibrationPoint[]) {
  if (points.length < 3) return null

  // Verwende die ersten 3 Punkte für die Transformation
  const p1 = points[0]
  const p2 = points[1]
  const p3 = points[2]

  // Matrix aufstellen: [x, y, 1] * M = [lat, lon]
  // M = [[a, b], [c, d], [e, f]]

  const det = (p1.pixelX - p3.pixelX) * (p2.pixelY - p3.pixelY) -
              (p2.pixelX - p3.pixelX) * (p1.pixelY - p3.pixelY)

  if (Math.abs(det) < 0.0001) return null // Punkte sind kollinear

  const a = ((p1.lat - p3.lat) * (p2.pixelY - p3.pixelY) -
             (p2.lat - p3.lat) * (p1.pixelY - p3.pixelY)) / det
  const b = ((p2.lat - p3.lat) * (p1.pixelX - p3.pixelX) -
             (p1.lat - p3.lat) * (p2.pixelX - p3.pixelX)) / det
  const e = p3.lat - a * p3.pixelX - b * p3.pixelY

  const c = ((p1.lon - p3.lon) * (p2.pixelY - p3.pixelY) -
             (p2.lon - p3.lon) * (p1.pixelY - p3.pixelY)) / det
  const d = ((p2.lon - p3.lon) * (p1.pixelX - p3.pixelX) -
             (p1.lon - p3.lon) * (p2.pixelX - p3.pixelX)) / det
  const f = p3.lon - c * p3.pixelX - d * p3.pixelY

  return { a, b, c, d, e, f }
}

// Transformiere Pixel-Koordinaten zu Geo-Koordinaten
function transformPoint(x: number, y: number, transform: { a: number; b: number; c: number; d: number; e: number; f: number }) {
  return {
    lat: transform.a * x + transform.b * y + transform.e,
    lon: transform.c * x + transform.d * y + transform.f
  }
}

export function MapCalibration({
  mapId,
  mapName,
  imageWidth,
  imageHeight,
  imageDataUrl,
  leafletMap,
  onClose,
  onSave
}: MapCalibrationProps) {
  const [points, setPoints] = useState<CalibrationPoint[]>([])
  const [currentPointId, setCurrentPointId] = useState<string | null>(null)
  const [step, setStep] = useState<'pixel' | 'geo'>('pixel')
  const [imageOverlay, setImageOverlay] = useState<L.ImageOverlay | null>(null)
  const [geoMarkers, setGeoMarkers] = useState<L.Marker[]>([])

  // Zoom und Pan für OZI-Bild
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [hasMoved, setHasMoved] = useState(false)

  // Neuen Punkt starten
  const startNewPoint = () => {
    const id = `point-${Date.now()}`
    setCurrentPointId(id)
    setStep('pixel')
  }

  // Pixel-Klick auf OZI-Bild
  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (step !== 'pixel' || !currentPointId) return
    if (hasMoved) return

    const img = e.currentTarget.querySelector('img')
    if (!img) return

    const imgRect = img.getBoundingClientRect()
    const clickX = e.clientX - imgRect.left
    const clickY = e.clientY - imgRect.top

    if (clickX < 0 || clickY < 0 || clickX > imgRect.width || clickY > imgRect.height) {
      return
    }

    const x = (clickX / imgRect.width) * imageWidth
    const y = (clickY / imgRect.height) * imageHeight

    // Füge temporären Punkt hinzu
    setPoints(prev => [...prev, {
      id: currentPointId,
      pixelX: Math.round(x),
      pixelY: Math.round(y),
      lat: 0,
      lon: 0
    }])

    setStep('geo')
  }

  // Geo-Klick auf OSM-Karte
  useEffect(() => {
    if (!leafletMap || step !== 'geo' || !currentPointId) return

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const updatedPoints = points.map(p => {
        if (p.id === currentPointId && p.lat === 0 && p.lon === 0) {
          return {
            ...p,
            lat: e.latlng.lat,
            lon: e.latlng.lng
          }
        }
        return p
      })

      setPoints(updatedPoints)

      // Marker hinzufügen
      const pointNumber = points.length
      const marker = L.marker([e.latlng.lat, e.latlng.lng], {
        icon: L.divIcon({
          html: `<div style="background: #3b82f6; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${pointNumber}</div>`,
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(leafletMap)

      setGeoMarkers(prev => [...prev, marker])
      setCurrentPointId(null)
      setStep('pixel')

      // Update Preview wenn wir mindestens 3 Punkte haben
      const completedPoints = updatedPoints.filter(p => p.lat !== 0 && p.lon !== 0)
      if (completedPoints.length >= 3) {
        updatePreview(completedPoints)
      }
    }

    leafletMap.on('click', handleMapClick)

    return () => {
      leafletMap.off('click', handleMapClick)
    }
  }, [leafletMap, step, currentPointId, points])

  // Preview-Overlay aktualisieren mit affiner Transformation
  const updatePreview = (calibrationPoints: CalibrationPoint[]) => {
    if (calibrationPoints.length < 3) return

    // Entferne altes Overlay
    if (imageOverlay) {
      imageOverlay.remove()
    }

    // Berechne affine Transformation
    const transform = calculateAffineTransform(calibrationPoints)
    if (!transform) return

    // Berechne die 4 Eckpunkte des Bildes
    const topLeft = transformPoint(0, 0, transform)
    const topRight = transformPoint(imageWidth, 0, transform)
    const bottomLeft = transformPoint(0, imageHeight, transform)
    const bottomRight = transformPoint(imageWidth, imageHeight, transform)

    // Finde min/max für Bounds
    const lats = [topLeft.lat, topRight.lat, bottomLeft.lat, bottomRight.lat]
    const lons = [topLeft.lon, topRight.lon, bottomLeft.lon, bottomRight.lon]

    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)

    // Erstelle Bounds - aber nur wenn das Bild nicht rotiert ist
    // Für rotierte Bilder müsste man L.ImageOverlay.Rotated verwenden
    const bounds = L.latLngBounds(
      L.latLng(minLat, minLon),
      L.latLng(maxLat, maxLon)
    )

    const overlay = L.imageOverlay(imageDataUrl, bounds, {
      opacity: 0.6,
      interactive: false
    }).addTo(leafletMap)

    setImageOverlay(overlay)
    leafletMap.fitBounds(bounds)
  }

  // Punkt löschen
  const deletePoint = (pointId: string) => {
    const index = points.findIndex(p => p.id === pointId)

    setPoints(prev => prev.filter(p => p.id !== pointId))

    // Lösche entsprechenden Marker
    if (index >= 0 && geoMarkers[index]) {
      geoMarkers[index].remove()
      setGeoMarkers(prev => prev.filter((_, i) => i !== index))
    }

    // Update Preview
    const remaining = points.filter(p => p.id !== pointId && p.lat !== 0)
    if (remaining.length >= 3) {
      updatePreview(remaining)
    } else if (imageOverlay) {
      imageOverlay.remove()
      setImageOverlay(null)
    }
  }

  // Speichern
  const handleSave = () => {
    const completedPoints = points.filter(p => p.lat !== 0 && p.lon !== 0)
    if (completedPoints.length < 3) {
      alert('Mindestens 3 Kalibrierungspunkte erforderlich')
      return
    }

    // Berechne affine Transformation
    const transform = calculateAffineTransform(completedPoints)
    if (!transform) {
      alert('Fehler bei der Berechnung der Transformation. Punkte sind kollinear.')
      return
    }

    // Berechne die 4 Eckpunkte
    const corners: CalibrationPoint[] = [
      {
        id: 'corner-tl',
        pixelX: 0,
        pixelY: 0,
        ...transformPoint(0, 0, transform)
      },
      {
        id: 'corner-tr',
        pixelX: imageWidth,
        pixelY: 0,
        ...transformPoint(imageWidth, 0, transform)
      },
      {
        id: 'corner-bl',
        pixelX: 0,
        pixelY: imageHeight,
        ...transformPoint(0, imageHeight, transform)
      },
      {
        id: 'corner-br',
        pixelX: imageWidth,
        pixelY: imageHeight,
        ...transformPoint(imageWidth, imageHeight, transform)
      }
    ]

    // Füge auch die Kalibrierungspunkte selbst hinzu für bessere Genauigkeit
    const allPoints = [...corners, ...completedPoints]

    onSave(allPoints)
  }

  // Cleanup beim Schließen
  useEffect(() => {
    return () => {
      if (imageOverlay) {
        imageOverlay.remove()
      }
      geoMarkers.forEach(m => {
        try {
          m.remove()
        } catch (e) {
          console.error('Error removing marker:', e)
        }
      })
    }
  }, [imageOverlay, geoMarkers])

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG') {
      setIsDragging(true)
      setHasMoved(false)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const deltaX = Math.abs(e.clientX - (dragStart.x + pan.x))
    const deltaY = Math.abs(e.clientY - (dragStart.y + pan.y))
    if (deltaX > 5 || deltaY > 5) {
      setHasMoved(true)
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(prev => Math.min(Math.max(1, prev + delta), 5))
  }

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const completedPoints = points.filter(p => p.lat !== 0 && p.lon !== 0)

  return (
    <>
      {/* Linkes Panel: OZI-Bild */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: '450px',
        background: 'rgba(0, 0, 0, 0.95)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '2px solid var(--color-primary)',
        boxShadow: '4px 0 20px rgba(0,0,0,0.5)'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          background: 'rgba(0, 0, 0, 1)',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              Karte kalibrieren
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: '4px 8px'
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {mapName}
          </div>
        </div>

        {/* Anleitung */}
        <div style={{
          padding: '16px 20px',
          background: step === 'pixel' && currentPointId
            ? 'rgba(59, 130, 246, 0.15)'
            : step === 'geo'
            ? 'rgba(34, 197, 94, 0.15)'
            : 'rgba(100, 100, 100, 0.15)',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
            {!currentPointId ? (
              <>
                <strong>Klicken Sie auf "Punkt hinzufügen"</strong>
                <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.9 }}>
                  Mindestens 3 Punkte erforderlich. Wählen Sie Punkte, die Sie eindeutig auf beiden Karten identifizieren können (Kreuzungen, Gebäudeecken, etc.)
                </div>
              </>
            ) : step === 'pixel' ? (
              <>
                <strong>Schritt 1: Punkt auf OZI-Karte wählen</strong>
                <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.9 }}>
                  Wählen Sie einen markanten Punkt (z.B. Kreuzung, Kirchturm)
                </div>
              </>
            ) : (
              <>
                <strong>Schritt 2: Gleichen Punkt auf OSM-Karte wählen</strong>
                <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.9 }}>
                  Klicken Sie auf denselben Punkt auf der Karte rechts
                </div>
              </>
            )}
          </div>
          <div style={{
            marginTop: '12px',
            fontSize: '12px',
            fontWeight: 600,
            color: completedPoints.length >= 3 ? '#22c55e' : '#f59e0b'
          }}>
            {completedPoints.length} / 3+ Punkte kalibriert
          </div>
        </div>

        {/* Zoom Controls */}
        <div style={{
          padding: '10px 20px',
          background: 'rgba(0, 0, 0, 0.5)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', flex: 1 }}>
            Zoom: {zoom.toFixed(1)}x
          </div>
          <button
            onClick={() => setZoom(prev => Math.min(prev + 0.5, 5))}
            style={{
              padding: '4px 10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            +
          </button>
          <button
            onClick={() => setZoom(prev => Math.max(prev - 0.5, 1))}
            style={{
              padding: '4px 10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            -
          </button>
          <button
            onClick={resetZoom}
            style={{
              padding: '4px 10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            Reset
          </button>
        </div>

        {/* OZI Bild */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            background: '#0a0a0a',
            position: 'relative',
            cursor: step === 'pixel' && currentPointId
              ? (isDragging && hasMoved ? 'grabbing' : 'crosshair')
              : 'grab'
          }}
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setIsDragging(false)
            setHasMoved(false)
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: 'center center'
            }}
            onClick={handleImageClick}
          >
            <img
              src={imageDataUrl}
              alt={mapName}
              draggable={false}
              onMouseDown={handleMouseDown}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                cursor: step === 'pixel' && currentPointId ? 'crosshair' : 'grab',
                border: '2px solid #3b82f6',
                borderRadius: '4px',
                display: 'block',
                maxWidth: 'none',
                userSelect: 'none'
              }}
            />
            {/* Zeige Punkte auf dem Bild */}
            {points.map((point, index) => (
              <div
                key={point.id}
                style={{
                  position: 'absolute',
                  left: `${(point.pixelX / imageWidth) * 100}%`,
                  top: `${(point.pixelY / imageHeight) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '28px',
                  height: '28px',
                  background: point.lat === 0 ? '#f59e0b' : '#22c55e',
                  color: 'white',
                  border: '3px solid white',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                  pointerEvents: 'none'
                }}
              >
                {index + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Punktliste */}
        <div style={{
          padding: '12px 20px',
          background: 'rgba(0, 0, 0, 0.8)',
          borderTop: '1px solid var(--border-color)',
          maxHeight: '150px',
          overflowY: 'auto'
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-muted)' }}>
            Kalibrierungspunkte
          </div>
          {points.map((point, index) => (
            <div
              key={point.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 8px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                marginBottom: '4px',
                fontSize: '11px',
                fontFamily: 'monospace'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: point.lat === 0 ? '#f59e0b' : '#22c55e',
                  color: 'white',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}>
                  {index + 1}
                </span>
                <span>
                  ({point.pixelX}, {point.pixelY})
                  {point.lat !== 0 && ` → (${point.lat.toFixed(5)}, ${point.lon.toFixed(5)})`}
                </span>
              </div>
              <button
                onClick={() => deletePoint(point.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  fontSize: '14px'
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-color)',
          background: 'rgba(0, 0, 0, 1)',
          display: 'flex',
          gap: '10px'
        }}>
          <button
            onClick={startNewPoint}
            disabled={!!currentPointId}
            style={{
              flex: 1,
              padding: '10px',
              background: currentPointId ? '#666' : '#22c55e',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              fontSize: '13px',
              fontWeight: 600,
              cursor: currentPointId ? 'not-allowed' : 'pointer',
              opacity: currentPointId ? 0.5 : 1
            }}
          >
            Punkt hinzufügen
          </button>
          <button
            onClick={handleSave}
            disabled={completedPoints.length < 3}
            style={{
              flex: 1,
              padding: '10px',
              background: completedPoints.length >= 3 ? '#3b82f6' : '#666',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              fontSize: '13px',
              fontWeight: 600,
              cursor: completedPoints.length >= 3 ? 'pointer' : 'not-allowed',
              opacity: completedPoints.length >= 3 ? 1 : 0.5
            }}
          >
            Speichern
          </button>
        </div>
      </div>

      {/* Hinweis-Overlay auf der Karte */}
      {step === 'geo' && currentPointId && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#22c55e',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          zIndex: 1500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'white',
            animation: 'pulse 2s infinite'
          }} />
          Klicken Sie auf Punkt #{points.length} auf der Karte
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  )
}
