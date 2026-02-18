# Changelog

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
