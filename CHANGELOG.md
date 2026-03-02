# Changelog

## [Unveröffentlicht]

## [1.2.1] - 2026-03-02

### Verbesserungen
- Performance: Trackpunkt-Anzeige nach Recording-Stopp massiv optimiert – App friert nicht mehr ein bei langen Flügen (2h+). Zoom-abhängige Anzeige: rausgezoomt wenige Punkte, reingezoomt alle Details. Nur sichtbare Punkte werden gerendert, CircleMarker statt DOM-Marker
- Meisterschaften (MS): Fahrt speichern hängt nicht mehr bei langsamer Verbindung – 15 Sekunden Timeout mit automatischem lokalem Fallback. Flight-Liste lädt nur Metadaten statt komplette Flugdaten
- Gas-Tracker Panel: Verschieben per Drag (Mouse und Touch) funktioniert jetzt korrekt
- Update-Download: Bei Fehler wird der Installer als Fallback im Browser geöffnet

### Bugfixes
- IndexedDB "database connection is closing" Fehler behoben – DB-Verbindung wird wiederverwendet
- UTM-Grid Endlosschleife bei Kartenverschiebung behoben (Maximum update depth exceeded)

## [1.2.0] - 2026-02-24

### Neue Features
- Outdoor-Modus (SUN-Button im Header): High-Contrast Modus für bessere Lesbarkeit bei Sonneneinstrahlung. Alle Panels passen sich dynamisch an. Einstellung wird gespeichert
- Timer & Wecker in Stoppuhr: Drei Tabs – Stoppuhr, Timer (Countdown mit Quick-Buttons) und Wecker (Alarm bei Uhrzeit). Akustischer Alarm mit einstellbarer Lautstärke
- Gas-Tracker: Schwebendes Panel mit SVG-Ballonkorb und bis zu 4 Gasflaschen. Live-Füllstand, Klick zum Aktivieren, Hover für Restliter/Restzeit. Konfiguration unter Einstellungen → Gas
- Funktionstasten (F1-F12): Unter Einstellungen → F-Tasten belegbar mit Marker Drop, Stoppuhr, Gas-Tracker, Tool-Panels, Wind-Panel, Briefing u.v.m.
- Schichtdicke beim Windimport: Filter im Import-Dialog (Alle / 100ft / 200ft / 500ft) – behält nur Schichten im gewählten Höhenraster
- Kurslinien – "Von aktueller Position": GPS-Position direkt als Startpunkt übernehmen ohne Karten-Klick

### Verbesserungen
- Update-Popup: Neues Design mit blauem Header, Bullet-Point Changelog, Hover-Effekten
- Admin-Panel: Crew zeigt Zugangsdaten (Benutzername + Passwort) statt Lizenzschlüssel
- Karten-Cursor: Standard-Windows-Pfeil statt Leaflet-Hand – präziseres Klicken
- Windimport: Automatische Einheiten-Erkennung aus Datei-Header (ft/m, MSL/AGL, km/h/m/s/kts, True/Magnetic, Ground Level). Manuelle Einheiten-Buttons entfernt – Vorschau zeigt Werte in App-Anzeigeeinheiten

### Bugfixes
- Vario-Einheit in Landeprognose und PDG/FON-Tool zeigt jetzt korrekt m/s oder fpm je nach Einstellung
- Stoppuhr-Label korrigiert (war fälschlicherweise "Timer")
- Windrichtungs-Anzeige (von/nach) überall korrekt – Windpfeile, Windlinien und Schicht-Visualisierung
- PDG/FON-Tool zeigt "Sinkrate" statt "Steigrate" wenn Sinken ausgewählt
- Tasks automatisch nach Task-Nummer sortiert
- Kurslinie "Position ändern" funktioniert jetzt korrekt (nicht nur Erstpositionierung)
- Heartbeat-Lizenzprüfung loggt nicht mehr bei kurzer Supabase-Unterbrechung aus
- Kartenposition wird nach Re-Login wiederhergestellt statt Default-Position
- Gas-Tracker Panel: Verschieben per Drag (Mouse und Touch) funktioniert jetzt korrekt
- Update-Download: Bei Fehler wird der Installer als Fallback im Browser geöffnet


## [1.1.2] - 2026-02-18
- Fix: Update-Download EBUSY-Fehler – Datei wird jetzt zuverlässig geschlossen bevor der Installer startet

## [1.1.1] - 2026-02-18
- Update-Popup: Professionelle Changelog-Anzeige mit Bullet Points
- GitHub Repo auf öffentlich gestellt – Update-Download funktioniert jetzt direkt

## [1.1.0] - 2026-02-18
- Einstellungen "UI Größe": Slider durch +/- Buttons ersetzt, Kompakt/Normal/Groß entfernt
- Admin-Panel: Passwort-Feld bei Crew-Erstellung, Zugangsdaten-Anzeige nach Erstellung, Passwort ändern für Crew
- Wind-Berechnung: Diskrete Windschichten statt linearer Interpolation (realistischer für Ballon-Trägheit)
- Marker-Drop: Realistische Physik-Simulation mit Luftwiderstand, Beschleunigungsphase, horizontaler Trägheit und Wind-Drag (Terminal Velocity default 10 m/s)
- Wind-Quellen-Filter: Alle/FC/Live/.dat im Windprofil wählbar – beeinflusst alle Berechnungen
- StatusBar zeigt aktiven Wind-Filter farbcodiert an (WIND: Alle/FC/Live/.dat)
- Windsond-Layer bekommen "WS" Badge, Pibal "PB", Manual "MAN" im Windprofil
- Task Edit Panel: Pfeil-Buttons zum Verschieben bei aktivem Verschiebe-Modus (für Stift/Touch)
- StatusBar: Mausposition-Elemente haben jetzt feste Breite – Layout springt nicht mehr wenn Maus die Karte verlässt
- Landeprognose: Höhen-Bucket auf 10m verfeinert und Hysterese auf 50m erhöht – Landepunkt springt nicht mehr bei konstantem Sinken
- GPS-Simulation: "Wind folgen" verwendet jetzt dieselben Funktionen wie alle Tools (interpolateWind + calculateDestination) – Simulation und Berechnungen liefern identische Ergebnisse
- PDG/FON: Trajektorie beim Punkt abgeschnitten, Vorlaufzeit mit Countdown, 30s Ramp-Up, Echtzeit "Benötigte Rate"-Anzeige
- Windrose: Kompakte SVG-Windrose mit umschaltbarer Profil-Ansicht (Windrichtung vs. Höhe) – Toggle im Windprofil-Panel, verschiebbar, skalierbar


## [1.0.0] - 2026-02-17
- Lizenzschlüssel-System (NTA-XXXX-XXXX-XXXX) mit PC-Bindung
- 48h Offline-Nutzung für Lizenz-User
- Admin-Panel: Benutzer erstellen, Lizenz anzeigen/regenerieren/entbinden
- Passwort-Login für Piloten deaktiviert (nur noch Lizenzschlüssel)
- Crew behält Benutzername/Passwort Login
- Update-Popup in App mit "Später"-Option im User-Menü
- Live Team: Echtzeit-Tracking, Team Chat, Ground Wind Reports
- Tasksheet PDF Import & Parser
- 3D Track-Ansicht (Cesium)
- Offline-Karten mit Region-Download
- Flytec BLS Bluetooth-Anbindung
- IGC Flight Recording & Export
