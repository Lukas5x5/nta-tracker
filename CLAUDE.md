# NTA Balloon Navigator - Projektregeln

## Sprache
- Kommunikation mit dem User auf Deutsch
- Code-Kommentare auf Deutsch

## Changelog
- Bei jeder Code-Änderung den Eintrag in `CHANGELOG.md` unter `## [Unveröffentlicht]` ergänzen
- Kurz und verständlich beschreiben was geändert wurde

## Versionen
- Beim Release müssen 3 Stellen aktualisiert werden:
  1. `package.json` → `"version"`
  2. `src/renderer/App.tsx` → `const APP_VERSION`
  3. `src/renderer/components/LoginScreen.tsx` → `const APP_VERSION`

## Git
- Aktueller Branch: `dev` (Entwicklung)
- `main` = stabile Release-Version, nicht direkt bearbeiten
- Release-Workflow: siehe `GIT-WORKFLOW.md` auf dem Desktop

## Projekt
- Desktop App: Electron + React + TypeScript
- Lite App: Vite + React (Web für Crew)
- Backend: Supabase (Auth, DB, Realtime)
- State Management: Zustand
- Karten: Leaflet + Cesium
