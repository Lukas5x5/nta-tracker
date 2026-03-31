# Git Workflow & Release-Anleitung - NTA Balloon Navigator

## Branches
- `main` = Stabile Release-Version (nicht direkt bearbeiten!)
- `dev` = Aktuelle Entwicklung

## Tägliches Arbeiten
```bash
git checkout dev          # Auf dev-Branch wechseln
# ... normal entwickeln ...
git add <dateien>
git commit -m "Beschreibung"
git push origin dev
```

---

## Release erstellen (Schritt für Schritt)

### Schritt 1: Version hochzählen (3 Stellen!)

In diesen 3 Dateien die Versionsnummer ändern (z.B. 1.2.3 → 1.2.4):

1. `package.json` → `"version": "1.2.4"`
2. `src/renderer/App.tsx` → `const APP_VERSION = '1.2.4'`
3. `src/renderer/components/LoginScreen.tsx` → `const APP_VERSION = '1.2.4'`

### Schritt 2: CHANGELOG.md aktualisieren

Unter `## [Unveröffentlicht]` einen neuen Versions-Block einfügen:
```markdown
## [1.2.4] - 2026-03-28
- Beschreibung was geändert wurde
```

### Schritt 3: Committen & Pushen
```bash
git add .
git commit -m "v1.2.4: Kurze Beschreibung"
git push origin dev
```

### Schritt 4: In main mergen
```bash
git checkout main
git merge dev --no-edit
git push origin main
```

### Schritt 5: Installer bauen
```bash
npm run build:electron
```
Wartet bis fertig (ca. 2-3 Minuten). Der Installer liegt dann in:
`release/NTA Balloon Navigator Setup 1.2.4.exe`

### Schritt 6: GitHub Release erstellen
```bash
gh release create v1.2.4 "release/NTA Balloon Navigator Setup 1.2.4.exe" --title "v1.2.4" --notes "Beschreibung der Änderungen"
```

### Schritt 7: Supabase aktualisieren (Update-Popup für alle User)

1. Öffne https://supabase.com → Dein Projekt → **Table Editor**
2. Tabelle **app_config** öffnen
3. Zeile **latest_version** anklicken
4. Das **value**-Feld ändern zu:
```json
{"version":"1.2.4","message":"Kurze Beschreibung des Updates","downloadUrl":"https://github.com/Lukas5x5/nta-tracker/releases/download/v1.2.4/NTA.Balloon.Navigator.Setup.1.2.4.exe"}
```

**WICHTIG:** Die `downloadUrl` muss exakt stimmen! Format:
```
https://github.com/Lukas5x5/nta-tracker/releases/download/v{VERSION}/NTA.Balloon.Navigator.Setup.{VERSION}.exe
```
Beachte: Leerzeichen im Dateinamen werden zu Punkten (`.`) in der GitHub-URL!

5. Speichern

→ Alle User sehen jetzt beim nächsten App-Start das Update-Popup mit **"Jetzt installieren"** Button.

### Schritt 8: Zurück auf dev wechseln
```bash
git checkout dev
```

---

## Kurzfassung (Copy-Paste)

Ersetze `1.2.4` durch die neue Version und `BESCHREIBUNG` durch den Changelog-Text:

```bash
# 1. Auf dev: Version committen & pushen
git add . && git commit -m "v1.2.4: BESCHREIBUNG" && git push origin dev

# 2. In main mergen & pushen
git checkout main && git merge dev --no-edit && git push origin main

# 3. Installer bauen
npm run build:electron

# 4. GitHub Release erstellen
gh release create v1.2.4 "release/NTA Balloon Navigator Setup 1.2.4.exe" --title "v1.2.4" --notes "BESCHREIBUNG"

# 5. Zurück auf dev
git checkout dev
```

Dann in **Supabase → app_config → latest_version → value** eintragen:
```json
{"version":"1.2.4","message":"BESCHREIBUNG","downloadUrl":"https://github.com/Lukas5x5/nta-tracker/releases/download/v1.2.4/NTA.Balloon.Navigator.Setup.1.2.4.exe"}
```

---

## Häufige Fehler

| Problem | Lösung |
|---------|--------|
| Update-Popup ohne "Jetzt installieren" Button | `downloadUrl` fehlt in Supabase `app_config` |
| User sehen kein Update-Popup | `version` in Supabase stimmt nicht mit der neuen Version überein |
| Installer-Download schlägt fehl | GitHub Release URL prüfen (Leerzeichen = Punkte) |
| Build schlägt fehl | `npm run build` erst testen, dann `npm run build:electron` |
| Falscher Branch | Immer auf `dev` entwickeln, nur für Release auf `main` mergen |

## Notfall: Zurück zum letzten Release
```bash
git checkout main         # Sofort stabile Version
npm run build:electron    # Stabile Version bauen
```

## Download-URL herausfinden
```bash
gh release view v1.2.4 --repo Lukas5x5/nta-tracker --json assets --jq '.assets[].url'
```
