# Changelog

## [Unveröffentlicht]

### Live Tracker / Team Chat
- Fix: Nachrichten gehen nicht mehr verloren wenn der Empfänger offline ist. Vorher wurden Team-Nachrichten nur über Supabase Realtime empfangen – war der Verfolger (oder ein anderes Teammitglied) gerade nicht auf der Webseite/in der App, gingen die Nachrichten verloren. Jetzt werden beim Verbinden/Einsteigen die letzten 50 Nachrichten aus der Datenbank geladen, sodass verpasste Nachrichten sofort sichtbar sind. Betrifft sowohl die Desktop App als auch die Lite Web-App.

### Live Tracker (Lite) - Karte
- Heading-Linie zeigt jetzt die Gradzahl an: Am Ende der gelben Richtungslinie (die anzeigt wohin der Pilot/Verfolger fährt) wird jetzt die aktuelle Fahrtrichtung in Grad angezeigt (z.B. "245°"). Gelbe Schrift mit schwarzem Rand für gute Lesbarkeit auf allen Kartenhintergründen.

## [1.2.7] - 2026-04-08

### Bugfixes
- Fix: 3D-Ansicht von gespeicherten Fahrten funktioniert wieder. Vorher versuchte die App die Flugdaten von Supabase zu laden (Fehler: "Cannot coerce the result to a single JSON object"), jetzt werden die lokalen Backups korrekt verwendet.

### Funktionstasten
- 8 neue Aktionen für F-Tasten Belegung: Wind Navigation (WNV), CPA Marker ein/aus, Outdoor-Modus umschalten, Zum Ballon fliegen, Nächstes/Vorheriges Ziel wählen, Hinein-/Herauszoomen.

### Aufnahme
- Auto-Takeoff Erkennung: Die Aufnahme startet jetzt automatisch wenn der Ballon abhebt. Erkennung über Variometer – wenn die Steigrate für ~5 Sekunden über 0.3 m/s bleibt, wird die Aufnahme gestartet. Standardmäßig aktiviert, kann in den Settings unter `autoTakeoffDetection` deaktiviert werden.

### UI
- APT (Altitude Profile Task) Panel: Outdoor-Modus Unterstützung hinzugefügt – Panel-Hintergrund, Input-Felder, Chart-Bereiche und Textfarben wechseln jetzt korrekt zwischen hellem und dunklem Design.
- Task-Bearbeitungspanel (Doppelklick auf Task): Outdoor-Modus Unterstützung hinzugefügt – Panel-Hintergrund, Koordinaten-Boxen, MMA/Ends-At-Felder, Reminder-Inputs und Beschreibungsbox wechseln jetzt korrekt zwischen hellem (Outdoor) und dunklem Design. Vorher blieb das Panel immer im dunklen Modus.

### Live Tracker (Lite)
- Fix: Verfolger wird nicht mehr ausgeloggt wenn er die Webseite kurz verlässt. Vorher führten Netzwerk-/Supabase-Fehler beim Session-Check zum sofortigen Logout. Jetzt wird bei Verbindungsfehlern die Session beibehalten – nur bei echtem Token-Mismatch (anderes Gerät) oder deaktiviertem Account wird ausgeloggt.
- Fix: Header/Footer auf manchen Handys abgeschnitten. Alle Screens nutzen jetzt `100dvh` (dynamic viewport height) statt `100vh` – berücksichtigt die Browser-Toolbars (URL-Leiste, Navigation) auf iOS Safari und Android Chrome korrekt.

### Navigation
- CPA-Button im Navi-Panel neben DROP: Zeigt live auf der Karte den besten Drop-Punkt an. Basierend auf aktuellem Heading wird berechnet wo man am nächsten am Ziel vorbeifährt – dort sollte man droppen. Teal-farbener Punkt auf der Karte mit gestrichelter Linie zum Goal und Distanz-Anzeige. Punkt wird grün wenn < 100m Distanz. Aktualisiert sich live bei jeder Position/Heading-Änderung.
- Navi-Panel kompakter: ft/m Toggle aus dem Header entfernt (Einstellung bleibt in den Settings). Padding, Margins, Gaps und Border-Radien reduziert – Panel braucht deutlich weniger Platz auf dem Bildschirm.
- CPA Drop-Alarm: Wenn der Pilot den CPA-Punkt erreicht (< 30m oder gerade vorbeigefahren), erscheint ein großes teal-farbenes "DROP!" Popup mit der Distanz zum Ziel + Drop-Signal-Sound (3 aufsteigende Beeps). Popup kann per Klick geschlossen werden, Reset wenn man sich > 100m entfernt.

### Tools
- Wind Navigation (WNV) BETA: Neues Tool das live die optimale Flugstrategie berechnet um ein Ziel am Boden zu erreichen. Simuliert verschiedene Höhen-Kombinationen (1-2 Legs) mit Sekunde-für-Sekunde Wind-Drift und findet die Route die am nächsten ans Ziel führt. Zeigt: Anweisung ("STEIGEN auf 3200 ft"), vorhergesagte Distanz zum Ziel, Flugplan mit allen Legs, vorhergesagten Pfad auf der Karte (amber gestrichelt) + Landepunkt. Auto-Recalculate alle 3 Sekunden für Live-Updates. Konfigurierbar: Steig-/Sinkrate, 1 oder 2 Legs, Wind-Quellen-Filter.
- Land Run Rechner: Berechnung und Karten-Anzeige (Dreieck, Legs, Punkte A/B/C) bleiben jetzt beim Schließen des Panels erhalten. Beim erneuten Öffnen sind Ergebnis, gewählte Alternative und alle Einstellungen (Modus, Einheit, Leg-Werte, Steigrate, Höhenlimit) noch da. Vorher wurde beim Schließen alles gelöscht.
- Land Run Rechner: Reset-Button im Header – erscheint nach einer Berechnung und löscht Ergebnis + Karten-Anzeige, Einstellungen bleiben erhalten.
- PDG/FON Cone Navigator: Wind-Quellen-Filter im Header hinzugefügt (Alle / FC / Live / .dat) – wie beim Windprofil-Panel. Damit kann man auswählen welche Windquellen für die Berechnung verwendet werden sollen, z.B. nur Forecast oder nur Live-gemessene Winde.
- PDG/FON Cone Navigator: Berechnet jetzt auch wenn keine echte Drehschicht vorhanden ist. Fallback auf die Schicht mit dem stärksten Wind. Bei fehlender oder eingeschränkter Drehschicht erscheint ein Bestätigungs-Popup: "Keine Drehschicht gefunden — trotzdem deklarieren?" mit Abbrechen/Trotzdem-Buttons. Nur bei perfekter Drehschicht wird sofort deklariert.
- PDG/FON Cone Navigator: Live-Pfad (blaue Linie) aktualisiert sich jetzt auch wenn das Panel geschlossen ist. Solange eine Deklaration aktiv ist, wird der Pfad bei jedem GPS-Update neu berechnet – unabhängig davon ob das Tool-Panel offen oder zu ist.

## [1.2.5] - 2026-03-31

### PDG/FON Cone Navigator – Komplett neu gebaut
- PDG/FON Rechner komplett neu geschrieben – sucht die beste Drehschicht (größte Windstreuung) im eingegebenen Höhenfenster und berechnet den optimalen Deklarationspunkt
- Höhenfenster: Nur Windschichten zwischen aktueller Höhe + Mindesthöhenänderung und Max-Höhe werden betrachtet. Ohne Max-Höhe werden alle verfügbaren Schichten verwendet
- Drehschicht-Suche: Prüft 4 Nachbar-Schichten über und unter jeder Kandidaten-Höhe, nimmt die Schicht mit der größten Rechts/Links-Streuung. Korrektur-Schichten dürfen auch außerhalb des Höhenfensters liegen
- Steuerungskegel auf der Karte: Halbtransparente Kegelfläche – gelb (Links-Korrektur) und blau (Rechts-Korrektur). Spitze = Deklarationspunkt, Öffnung = Richtung Pilot
- Blaue Linie (Live-Pfad): Zeigt live wo der Pilot mit aktueller Vario-Rate auf Zielhöhe ankommt. Aktualisiert sich bei jedem GPS-Update. Verschwindet wenn Zielhöhe erreicht ist
- Optimale Steigrate: Berechnet die benötigte Rate um an der Kegelmitte auf Zielhöhe zu sein (max 5 m/s). Deklarationspunkt wird so gesetzt dass die Rate realistisch bleibt
- Alle Höhen auf 50ft gerundet für saubere Deklarationswerte
- Warnung bei großen Höhensprüngen (>500ft) zwischen Mitte und Links/Rechts-Korrektur
- Kursabweichung live angezeigt (°links/rechts vorbei, farbcodiert grün/gelb/rot)
- Korrektur-Höhen (Links/Mitte/Rechts): Zeigt "—" wenn keine Korrektur in eine Richtung möglich ist
- Panel-State bleibt bei Schließen/Öffnen erhalten (Deklaration, Kegel, Live-Pfad im globalen Store)
- Kompaktes, aufgeräumtes UI – Zielhöhe groß und prominent, Koordinaten gut lesbar (nur Easting/Northing bei MGRS)

### Wind
- Wind Forecast (FC): Deutlich feinere Auflösung – 17 Drucklevel statt 8 (alle 25hPa von 1000 bis 500hPa). Deckt Höhen bis ~18.000ft ab mit Schichten ca. alle 250-300ft statt alle 500-1000ft
- Wind-Panel: Klick auf Windschicht aktiviert direkt die Windlinie zum Zeichnen – kein extra Nadel-Button mehr nötig
- Wind-Panel: Neuer "Zur aktuellen Höhe" Button – scrollt die Windschichten-Liste zur aktuellen Flughöhe
- Wind-Panel: Windschicht-Farben im Outdoor-Modus abgedunkelt (filter: brightness) für bessere Lesbarkeit. Kurs-Farbe von Gelb auf dunkles Gold

### Land Run
- Land Run Rechner: UI komplett überarbeitet und aufgeräumt – kompaktere Darstellung, gleicher Stil wie PDG Panel. Modus/Einheit-Buttons, Slider, Höhenbegrenzung und Ergebnis deutlich platzsparender

### Landeprognose
- Landeprognose: Neue "Live Vario" Option – Checkbox aktiviert automatische Übernahme der aktuellen Sinkrate aus dem Variometer/BLS-Sensor. Slider verschwindet, Rate wird bei jedem GPS-Update live aktualisiert. Zeigt wo der Pilot mit der aktuellen Sinkrate landen wird

### Track
- Track-Punkte werden nach Recording-Stopp nicht mehr als Marker angezeigt. Stattdessen: Hover über die Track-Linie zeigt Popup im Marker-Drop-Stil mit Höhe, Geschwindigkeit, Heading, Uhrzeit, Grid-Koordinaten, UTM und WGS84
- Unsichtbare dickere Hit-Area (20px) über dem Track für einfaches Hovern

### Navigation Panel
- Individuelle Farbauswahl für Text und Hintergrund pro Navi-Feld – Color Picker für beliebige Farben, Custom-Farben werden gespeichert und bei allen Feldern angezeigt. Löschbar per Klick auf das × am Farbfeld
- Kurslinie Badge: Bei Linientyp "Beides" sitzt das Kurs-Badge nicht mehr auf dem Ziel sondern auf der halben "Zu"-Seite
- Kurslinie Snapping: Snap-Radius von 10m auf 50m erhöht für einfacheres Positionieren auf Ziele

### Task Edit Panel
- Panel-Position wird beim Schließen gespeichert und beim nächsten Öffnen wiederhergestellt

### Live Team
- Team-Nachricht Popup: Klick auf den Toast öffnet direkt ein Antwort-Eingabefeld. Enter sendet, Escape schließt. Kein Umweg über das Live-Team Panel nötig

### Outdoor-Modus – Komplett überarbeitet
- Alle Panels: Weißer Hintergrund mit dunkler Schrift im Outdoor-Modus (NavigationPanel, Header, StatusBar, PDG/FON, Land Run, Stopwatch, MeasureTool, DrawingPanel, BriefingPanel, FlightWindsPanel, WindPanel, WindRose, AltitudeProfilePanel, TaskSettingsPanel, ChampionshipPanel, CompetitionAreaPanel, ConnectionModal, TasksheetImportPanel, TrajectoryPanel, PZDrawPanel, TaskEditPanel, GasPanel, LiveTeamPanel)
- Outdoor-Modus Farben: Akzentfarben (Grün, Cyan, Orange, Blau) werden im Outdoor-Modus dunkler dargestellt für besseren Kontrast auf weißem Hintergrund
- Alle Schriften im Outdoor-Modus fetter (font-weight: 750) für bessere Lesbarkeit bei Sonnenlicht
- Footer-Leiste (StatusBar): Weißer Hintergrund mit dunkler Schrift. WGS84-Koordinaten aus der Footer-Leiste entfernt
- CSS-Overrides für Panel-Hintergründe entfernt – alles über inline getOutdoor()-Werte gesteuert
- Farbkanal-System: Neues `o.c` Property (255=weiß im Dark Mode, 0=schwarz im Outdoor) für automatische Textfarben-Anpassung

### Live Tracker (Crew/Lite App)
- Ballon-Cursor: Pilot-Marker als SVG-Heißluftballon mit farbiger Hülle, Glanz-Effekt, Seilen und Korb. Callsign wird auf der Hülle angezeigt, offline-Piloten halbtransparent
- Track-Linie: Crew sieht den gesamten Flugweg des Piloten als farbige Polyline auf der Karte. Track-History wird bei jedem Positions-Update gesammelt (max 2000 Punkte pro Pilot)
- Chat-Popup: Bei neuen Team-Nachrichten erscheint ein Toast mit Absender und Nachricht (8s sichtbar). Klick auf den Toast öffnet direkt den Chat zum Antworten
- Unread-Badge: Roter Zähler am Chat-Button zeigt ungelesene Nachrichten, verschwindet beim Öffnen des Chats

### Sonstiges
- Fahrten werden komplett lokal gespeichert statt in Supabase – schneller, zuverlässiger, kein Internet nötig
- OSM Tile-Server: URL-Pattern für Referer-Header erweitert für bessere Kompatibilität

## [1.2.4] - 2026-03-28
- Meisterschaften: Lokale Backups laden – neuer Button "Lokale Backups laden" unterhalb der Fahrten-Liste. Zeigt alle lokal gespeicherten Backup-Dateien aus %APPDATA%\nta-balloon-navigator\backups\ mit Name, Datum und Größe an. Per Klick auf "Laden" wird das Backup direkt in die App geladen. Nützlich wenn Supabase-Verbindung nicht verfügbar ist oder Fahrten nicht angezeigt werden

## [1.2.3] - 2026-03-02
- Alle Fixes aus v1.2.1 enthalten (siehe unten)
- Automatische Cache-Invalidierung bei App-Updates – Flights-Cache wird bei Versionswechsel automatisch zurückgesetzt, damit 3D-Button und andere Daten sofort korrekt angezeigt werden

## [1.2.1] - 2026-03-02

### Verbesserungen
- Performance: Trackpunkt-Anzeige nach Recording-Stopp massiv optimiert – App friert nicht mehr ein bei langen Flügen (2h+). Zoom-abhängige Anzeige: rausgezoomt wenige Punkte, reingezoomt alle Details. Nur sichtbare Punkte werden gerendert, CircleMarker statt DOM-Marker
- Meisterschaften (MS): Fahrt speichern hängt nicht mehr bei langsamer Verbindung – 15 Sekunden Timeout mit automatischem lokalem Fallback. Flight-Liste lädt nur Metadaten statt komplette Flugdaten
- Gas-Tracker Panel: Verschieben per Drag (Mouse und Touch) funktioniert jetzt korrekt
- Update-Download: Bei Fehler wird der Installer als Fallback im Browser geöffnet

### Bugfixes
- Lizenzschlüssel muss nach Update nicht mehr neu eingegeben werden – Session bleibt bei App-Updates erhalten
- IndexedDB "database connection is closing" Fehler behoben – DB-Verbindung wird wiederverwendet
- UTM-Grid Endlosschleife bei Kartenverschiebung behoben (Maximum update depth exceeded)
- 3D-Button bei gespeicherten Flügen wird wieder korrekt angezeigt

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
