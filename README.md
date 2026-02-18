# NTA Balloon Navigator

Navigations- und Wettbewerbssoftware für die Österreichische Heißluftballon-Nationalmannschaft.

## Desktop App (Electron)

### GPS & Navigation
- Echtzeit GPS-Tracking über Flytec BLS Sensor (Bluetooth LE, NMEA)
- GPS 5Hz + Barometer 8Hz
- Höhenanzeige (MSL / AGL), Groundspeed, Heading, Variometer
- IGC Flight Recording & Export

### Wettbewerbs-Tasks
- PDG, JDG, HWZ, FIN, FON, ELB, HNH, 3D Tasks
- Elektronische Marker Drops & Goal Declarations (je bis zu 18)
- Task Rings, Scoring Areas, Transit Points
- Tasksheet PDF Import & Parser

### Karten
- Leaflet mit OpenStreetMap + Offline-Kartenmaterial
- Cesium 3D-Ansicht (Track3DView)
- UTM / WGS84 / MGRS Koordinatensystem
- Höhendaten (DEM), Stromleitungslayer
- OZF Kartenimport mit Kalibrierung
- Region-Download für Offline-Nutzung

### Wind-Analyse
- Windreader Import
- Flight Winds Aufzeichnung & Visualisierung
- Trajektorien-Berechnung & Import

### Live Team
- Echtzeit-Positionsübertragung (Supabase Realtime)
- Team Chat
- Crew Ground Wind Reports
- Championship / Wettbewerbsverwaltung

### Benutzer & Lizenz
- Lizenzschlüssel-System (NTA-XXXX-XXXX-XXXX)
- PC-Bindung pro Lizenz, 48h Offline-Nutzung
- Admin-Panel für Benutzerverwaltung
- Auto-Update Benachrichtigung

## Lite App (Web)

Webbasierte Crew-App für Bodenpersonal:
- Live-Tracking aller Piloten auf der Karte
- Team Chat
- Ground Wind Reports
- Task-Übersicht

## Tech Stack

| Komponente | Technologie |
|---|---|
| Desktop App | Electron + React + TypeScript |
| Lite App | Vite + React + TypeScript |
| Karten | Leaflet, Cesium, Proj4 |
| State | Zustand |
| Backend | Supabase (Auth, DB, Realtime) |
| Bluetooth | SerialPort (NMEA) |
| Build | electron-builder (NSIS Installer) |

## Entwicklung

```bash
npm install                # Abhängigkeiten installieren
npm run dev                # Desktop App starten (Dev)
npm run dev:lite           # Lite Web App starten (Dev)
npm run build:electron     # Release Build (Windows Installer)
npm run build:lite         # Lite App Build
```

## Projektstruktur

```
src/
  main/           # Electron Main Process
    bluetooth/    # Flytec BLS Bluetooth
    maps/         # Tile Cache, OZF Parser, Region Download
    elevation/    # DEM Höhendaten
  renderer/       # Electron Renderer (React)
    components/   # UI Komponenten
    stores/       # Zustand Stores (auth, flight, team)
    services/     # ProfileSync, PositionBroadcaster
    utils/        # Koordinaten, Navigation, Parser
  lite/           # Lite Web App (Crew)
  shared/         # Geteilte Types
```

## Lizenz

Proprietär - Österreichische Heißluftballon-Nationalmannschaft
