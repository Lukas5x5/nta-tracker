// Electron modules - CommonJS require to avoid top-level evaluation issues
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')

// Hardware-Beschleunigung aktivieren für bessere Grafikleistung
// WICHTIG: Diese müssen VOR app.whenReady() ausgeführt werden
if (app && app.commandLine) {
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
}

// Lazy imports für Module mit native Addons
type BluetoothManagerType = import('./bluetooth/BluetoothManager').BluetoothManager
type MapManagerType = import('./maps/MapManager').MapManager
type ElevationManagerType = import('./elevation/ElevationManager').ElevationManager

let mainWindow: typeof BrowserWindow.prototype | null = null
let bluetoothManager: BluetoothManagerType | null = null
let mapManager: MapManagerType | null = null
let elevationManager: ElevationManagerType | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'NTA - Balloon Navigator',
    // Verhindere weißes Flackern beim Start
    show: false,
    backgroundColor: '#0a0f1e',
    // Vollbild-Optionen
    fullscreenable: true,
    simpleFullscreen: false,  // Native Fullscreen (ohne macOS Spaces)
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Web Security deaktivieren für externe Tile-Server (Satellitenbilder etc.)
      webSecurity: false
    }
  })

  // Fenster erst zeigen wenn Inhalt bereit ist (verhindert weißes Flackern)
  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
  })

  // Menüleiste entfernen (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null)

  // In Entwicklung: Vite Dev Server
  if (process.env.NODE_ENV === 'development') {
    // Vollständige Cache-Bereinigung vor dem Laden
    const session = mainWindow.webContents.session
    Promise.all([
      session.clearCache(),
      session.clearStorageData({
        storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
      })
    ]).then(() => {
      mainWindow!.loadURL('http://localhost:5173')
      mainWindow!.webContents.openDevTools()
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // F11 für Vollbild-Toggle registrieren
  const { globalShortcut } = require('electron')
  globalShortcut.register('F11', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  // ESC zum Beenden des Vollbildmodus
  globalShortcut.register('Escape', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false)
    }
  })

  // Elevation Manager initialisieren (HGT-Bodenhoehe)
  try {
    const { ElevationManager } = require('./elevation/ElevationManager')
    elevationManager = new ElevationManager(app.getPath('userData'))
    console.log('[Main] ElevationManager initialisiert')
  } catch (err) {
    console.error('[Main] ElevationManager konnte nicht geladen werden:', err)
  }

  // Bluetooth Manager initialisieren (lazy import)
  const { BluetoothManager } = require('./bluetooth/BluetoothManager')
  bluetoothManager = new BluetoothManager()

  // Fehler-Events vom BluetoothManager weiterleiten
  if (bluetoothManager) {
    bluetoothManager.on('error', (error: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bluetooth:error', {
          message: error.message || 'Bluetooth-Fehler',
          details: error.originalError?.message
        })
      }
    })

    // Disconnect-Events weiterleiten
    bluetoothManager.on('disconnected', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bluetooth:disconnected')
      }
    })

    // Debug-Stats weiterleiten (alle 500ms vom BluetoothManager)
    bluetoothManager.on('debug', (stats: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bluetooth:debug', stats)
      }
    })
  }

  setupIpcHandlers()
}

function setupIpcHandlers() {
  // Bluetooth Verbindung
  ipcMain.handle('bluetooth:scan', async () => {
    return bluetoothManager?.scanForDevices()
  })

  ipcMain.handle('bluetooth:connect', async (_: any, deviceId: string) => {
    try {
      const success = await bluetoothManager?.connect(deviceId)
      return { success: success || false, error: null }
    } catch (error: any) {
      console.error('Bluetooth connect error:', error)
      return {
        success: false,
        error: error.message || 'Verbindungsfehler'
      }
    }
  })

  ipcMain.handle('bluetooth:disconnect', async () => {
    return bluetoothManager?.disconnect()
  })

  // GPS Daten Stream
  ipcMain.on('gps:subscribe', (event: any) => {
    bluetoothManager?.onGPSData((data: any) => {
      event.sender.send('gps:data', data)
    })
  })

  // Barometer Daten Stream
  ipcMain.on('baro:subscribe', (event: any) => {
    bluetoothManager?.onBaroData((data: any) => {
      event.sender.send('baro:data', data)
    })
  })

  // Map Management - lazy import um sicherzustellen dass app.getPath() funktioniert
  const { getMapManager } = require('./maps/MapManager')
  mapManager = getMapManager()

  ipcMain.handle('maps:import', async () => {
    return mapManager!.importMap()
  })

  ipcMain.handle('maps:importWithImage', async (_: any, mapFilePath: string, imagePath: string) => {
    return mapManager!.importMapWithImage(mapFilePath, imagePath)
  })

  ipcMain.handle('maps:list', async () => {
    return mapManager!.getMapList()
  })

  ipcMain.handle('maps:remove', async (_: any, mapId: string) => {
    return mapManager!.removeMap(mapId)
  })

  ipcMain.handle('maps:getImagePath', async (_: any, mapId: string) => {
    return mapManager!.getImagePath(mapId)
  })

  ipcMain.handle('maps:getImageDataUrl', async (_: any, mapId: string) => {
    return mapManager!.getImageAsDataUrl(mapId)
  })

  // Tile-Server Info für große Karten
  ipcMain.handle('maps:getTileInfo', async (_: any, mapId: string) => {
    return mapManager!.getMapTileInfo(mapId)
  })

  ipcMain.handle('maps:geoToPixel', async (_: any, mapId: string, lat: number, lon: number) => {
    return mapManager!.geoToPixel(mapId, lat, lon)
  })

  ipcMain.handle('maps:pixelToGeo', async (_: any, mapId: string, x: number, y: number) => {
    return mapManager!.pixelToGeo(mapId, x, y)
  })

  ipcMain.handle('maps:geoToDisplayCoord', async (_: any, mapId: string, lat: number, lon: number) => {
    return mapManager!.geoToDisplayCoord(mapId, lat, lon)
  })

  ipcMain.handle('maps:findForLocation', async (_: any, lat: number, lon: number) => {
    return mapManager!.findMapsForLocation(lat, lon)
  })

  ipcMain.handle('maps:updateCalibration', async (_: any, mapId: string, points: any[]) => {
    return mapManager!.updateCalibration(mapId, points)
  })

  // Prüfe ob Tiles gecacht sind
  ipcMain.handle('maps:areTilesCached', async (_: any, mapId: string) => {
    return mapManager!.areTilesCached(mapId)
  })

  // Importiere Karte für Meisterschaft (öffnet Dialog, importiert, gibt MapInfo zurück)
  ipcMain.handle('maps:importForChampionship', async () => {
    // Erst MAP Datei auswählen
    const mapResult = await dialog.showOpenDialog({
      title: 'Kalibrierungsdatei (.map) auswählen',
      filters: [
        { name: 'OziExplorer Map Files', extensions: ['map'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (mapResult.canceled || !mapResult.filePaths[0]) {
      return null
    }

    // Dann Bilddatei auswählen
    const imageResult = await dialog.showOpenDialog({
      title: 'Kartenbild auswählen',
      filters: [
        { name: 'Bilddateien', extensions: ['tif', 'tiff', 'jpg', 'jpeg', 'png', 'bmp'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (imageResult.canceled || !imageResult.filePaths[0]) {
      return null
    }

    // Importiere die Karte
    return mapManager!.importMapWithImage(mapResult.filePaths[0], imageResult.filePaths[0])
  })

  // Hole Karte nach ID
  ipcMain.handle('maps:getById', async (_: any, mapId: string) => {
    return mapManager!.getMapById(mapId)
  })

  // Generiere Tiles mit Fortschritt
  ipcMain.handle('maps:prepareTiles', async (event: any, mapId: string) => {
    const progressCallback = (progress: number, total: number) => {
      event.sender.send(`maps:prepareTiles:progress:${mapId}`, progress, total)
    }
    return mapManager!.prepareTilesWithProgress(mapId, progressCallback)
  })

  // Reprojiziere Karte (einmalig, für schnelles ImageOverlay)
  ipcMain.handle('maps:reprojectImage', async (event: any, mapId: string) => {
    const progressCallback = (message: string, percent: number) => {
      event.sender.send(`maps:reprojectImage:progress:${mapId}`, message, percent)
    }
    return mapManager!.reprojectImage(mapId, progressCallback)
  })

  // Prüfe ob reprojiziertes Bild existiert
  ipcMain.handle('maps:hasReprojectedImage', async (_: any, mapId: string) => {
    return mapManager!.hasReprojectedImage(mapId)
  })

  // === NEUES TILE-SYSTEM ===

  // Prüfe ob Tiles für eine Karte existieren
  ipcMain.handle('maps:hasTiles', async (_: any, mapId: string) => {
    return mapManager!.hasMapTiles(mapId)
  })

  // Hole Tile-Index für eine Karte
  ipcMain.handle('maps:getTileIndex', async (_: any, mapId: string) => {
    return mapManager!.getMapTileIndex(mapId)
  })

  // Generiere Tiles für eine Karte
  ipcMain.handle('maps:generateTiles', async (event: any, mapId: string) => {
    const progressCallback = (message: string, percent: number) => {
      event.sender.send(`maps:generateTiles:progress:${mapId}`, message, percent)
    }
    return mapManager!.generateMapTiles(mapId, progressCallback)
  })

  // Hole Tile als Data-URL
  ipcMain.handle('maps:getTileDataUrl', async (_: any, mapId: string, tileX: number, tileY: number) => {
    return mapManager!.getTileDataUrl(mapId, tileX, tileY)
  })

  // Hole UTM-Kalibrierung für Pixel-basierte Darstellung (OziMapView)
  ipcMain.handle('maps:getUTMCalibration', async (_: any, mapId: string) => {
    return mapManager!.getUTMCalibration(mapId)
  })

  // Parse nur die Eckpunkte aus einer .map Datei (für Competition Area)
  ipcMain.handle('maps:parseCorners', async () => {
    const fs = require('fs')

    // Dialog öffnen um .map Datei auszuwählen
    const result = await dialog.showOpenDialog({
      title: 'OZI Kartendatei (.map) für Wettkampfbereich auswählen',
      filters: [
        { name: 'OziExplorer Map Files', extensions: ['map'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    try {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8')
      const lines = content.split(/\r?\n/)

      // MMPLL Punkte extrahieren (Lon, Lat)
      const mmpllPoints: { lat: number; lon: number }[] = []
      // UTM Zone extrahieren
      let utmZone = 33 // Default

      for (const line of lines) {
        // MMPLL,1, 8.728867, 48.572796
        if (line.startsWith('MMPLL,')) {
          const parts = line.split(',')
          if (parts.length >= 4) {
            const lon = parseFloat(parts[2].trim())
            const lat = parseFloat(parts[3].trim())
            if (!isNaN(lat) && !isNaN(lon)) {
              mmpllPoints.push({ lat, lon })
            }
          }
        }
        // UTM Zone aus Kalibrierungspunkten (grid, 32, ...)
        if (line.includes('grid,')) {
          const match = line.match(/grid,\s*(\d+),/)
          if (match) {
            utmZone = parseInt(match[1])
          }
        }
      }

      if (mmpllPoints.length < 4) {
        console.log('Weniger als 4 MMPLL Punkte gefunden:', mmpllPoints.length)
        return null
      }

      // Reihenfolge: MMPLL,1 = topLeft (NW), MMPLL,2 = topRight (NO),
      //              MMPLL,3 = bottomRight (SO), MMPLL,4 = bottomLeft (SW)
      return {
        name: path.basename(result.filePaths[0], '.map'),
        utmZone,
        corners: {
          nw: mmpllPoints[0],  // topLeft
          no: mmpllPoints[1],  // topRight
          so: mmpllPoints[2],  // bottomRight
          sw: mmpllPoints[3]   // bottomLeft
        }
      }
    } catch (error) {
      console.error('Fehler beim Parsen der .map Datei:', error)
      return null
    }
  })

  // Dialog zum Öffnen von MAP + Bild Dateien
  ipcMain.handle('maps:selectFiles', async () => {
    // Erst MAP Datei auswählen
    const mapResult = await dialog.showOpenDialog({
      title: 'Kalibrierungsdatei (.map) auswählen',
      filters: [
        { name: 'OziExplorer Map Files', extensions: ['map'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (mapResult.canceled || !mapResult.filePaths[0]) {
      return null
    }

    // Dann Bilddatei auswählen
    const imageResult = await dialog.showOpenDialog({
      title: 'Kartenbild auswählen',
      filters: [
        { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (imageResult.canceled || !imageResult.filePaths[0]) {
      return null
    }

    return {
      mapPath: mapResult.filePaths[0],
      imagePath: imageResult.filePaths[0]
    }
  })

  // File Operations
  const fs = require('fs')
  const fsPromises = fs.promises
  const { format } = require('date-fns')

  ipcMain.handle('files:saveIGC', async (_: any, data: string, filename: string) => {
    try {
      const downloadsPath = app.getPath('downloads')
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss')
      const finalFilename = filename || `flight_${timestamp}.igc`
      const filepath = path.join(downloadsPath, finalFilename)

      await fsPromises.writeFile(filepath, data, 'utf-8')
      return filepath
    } catch (error: any) {
      console.error('Error saving IGC:', error)
      throw error
    }
  })

  ipcMain.handle('files:loadWaypoints', async (_: any, filepath: string) => {
    try {
      const data = await fsPromises.readFile(filepath, 'utf-8')
      // Hier könnte Waypoint-Parsing implementiert werden
      return JSON.parse(data)
    } catch (error: any) {
      console.error('Error loading waypoints:', error)
      return []
    }
  })

  ipcMain.handle('files:saveFlightReport', async (_: any, report: any) => {
    try {
      const downloadsPath = app.getPath('downloads')
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss')
      const filename = `flight_report_${timestamp}.json`
      const filepath = path.join(downloadsPath, filename)

      await fsPromises.writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8')
      return filepath
    } catch (error: any) {
      console.error('Error saving flight report:', error)
      throw error
    }
  })

  // Tile Cache Management
  const { getTileCacheManager } = require('./maps/TileCacheManager')
  const tileCache = getTileCacheManager()

  // Prüfe ob Tile im Cache ist
  ipcMain.handle('tiles:has', async (_: any, provider: string, z: number, x: number, y: number) => {
    return tileCache.hasTile(provider, z, x, y)
  })

  // Hole Tile aus Cache
  ipcMain.handle('tiles:get', async (_: any, provider: string, z: number, x: number, y: number) => {
    return tileCache.getTile(provider, z, x, y)
  })

  // Batch: Lade mehrere Tiles auf einmal (für schnelles Preloading)
  ipcMain.handle('tiles:getBatch', async (_: any, provider: string, coords: Array<{ z: number; x: number; y: number }>) => {
    const results: Array<{ z: number; x: number; y: number; dataUrl: string | null }> = []
    for (const coord of coords) {
      const dataUrl = await tileCache.getTile(provider, coord.z, coord.x, coord.y)
      results.push({ z: coord.z, x: coord.x, y: coord.y, dataUrl })
    }
    return results
  })

  // Speichere Tile im Cache (Base64 vom Renderer)
  ipcMain.handle('tiles:save', async (_: any, provider: string, z: number, x: number, y: number, base64Data: string) => {
    return tileCache.saveTileBase64(provider, z, x, y, base64Data)
  })

  // Cache-Statistiken
  ipcMain.handle('tiles:stats', async () => {
    return tileCache.getStats()
  })

  // Cache leeren
  ipcMain.handle('tiles:clear', async (_: any, provider?: string) => {
    return tileCache.clearCache(provider)
  })

  // Cache-Verzeichnis ermitteln
  ipcMain.handle('tiles:getCacheDir', async () => {
    return tileCache.getCacheDirectory()
  })

  // Tiles für Wettkampfbereich zählen
  ipcMain.handle('tiles:countForBounds', async (
    _: any,
    points: Array<{ lat: number; lon: number }>,
    minZoom: number,
    maxZoom: number
  ) => {
    const tiles = tileCache.getTilesForPolygon(points, minZoom, maxZoom)
    return {
      count: tiles.length,
      estimatedSize: tileCache.estimateDownloadSize(tiles.length)
    }
  })

  // Download-Status tracking
  let downloadAbortSignal: { aborted: boolean } | null = null

  // Tiles für Wettkampfbereich herunterladen
  ipcMain.handle('tiles:downloadForBounds', async (
    event: any,
    urlTemplate: string,
    provider: string,
    points: Array<{ lat: number; lon: number }>,
    minZoom: number,
    maxZoom: number
  ) => {
    downloadAbortSignal = { aborted: false }

    const result = await tileCache.downloadTilesForBounds(
      urlTemplate,
      provider,
      points,
      minZoom,
      maxZoom,
      (progress: { total: number; downloaded: number; cached: number; failed: number; currentTile: string }) => {
        // Sende Progress-Updates an Renderer
        event.sender.send('tiles:downloadProgress', progress)
      },
      downloadAbortSignal
    )

    downloadAbortSignal = null
    return result
  })

  // Download abbrechen
  ipcMain.handle('tiles:cancelDownload', async () => {
    if (downloadAbortSignal) {
      downloadAbortSignal.aborted = true
      return true
    }
    return false
  })

  // MBTiles Import
  let mbtilesImportAbortSignal: { aborted: boolean } | null = null

  ipcMain.handle('tiles:importMBTiles', async (event: any, provider: string) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'MBTiles Datei importieren',
      filters: [
        { name: 'MBTiles Dateien', extensions: ['mbtiles'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    mbtilesImportAbortSignal = { aborted: false }

    const importResult = await tileCache.importMBTiles(
      result.filePaths[0],
      provider,
      (progress: any) => {
        event.sender.send('tiles:importMBTilesProgress', progress)
      },
      mbtilesImportAbortSignal
    )

    mbtilesImportAbortSignal = null
    return importResult
  })

  ipcMain.handle('tiles:cancelMBTilesImport', async () => {
    if (mbtilesImportAbortSignal) {
      mbtilesImportAbortSignal.aborted = true
      return true
    }
    return false
  })

  // Tiles zu UTM-reprojiziertem Bild zusammenfügen
  ipcMain.handle('tiles:mergeAndReproject', async (
    event: any,
    provider: string,
    points: Array<{ lat: number; lon: number }>,
    zoomLevel: number,
    utmZone: number
  ) => {
    return tileCache.mergeAndReprojectTiles(
      provider,
      points,
      zoomLevel,
      utmZone,
      (message: string, percent: number) => {
        event.sender.send('tiles:reprojectProgress', { message, percent })
      }
    )
  })

  // Lade reprojiziertes Bild als Data-URL
  ipcMain.handle('tiles:getReprojectedImage', async (_: any, imagePath: string) => {
    const fs = require('fs')
    try {
      if (!fs.existsSync(imagePath)) {
        console.error('Reprojected image not found:', imagePath)
        return null
      }
      const data = fs.readFileSync(imagePath)
      const ext = imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
      return `data:image/${ext};base64,${data.toString('base64')}`
    } catch (error) {
      console.error('Error loading reprojected image:', error)
      return null
    }
  })

  // Region Download für Admin (komplette Länder als MBTiles)
  let regionDownloadAbort: { aborted: boolean } | null = null

  ipcMain.handle('tiles:downloadRegion', async (
    event: any,
    name: string,
    bounds: { north: number; south: number; east: number; west: number },
    minZoom: number,
    maxZoom: number
  ) => {
    const { getRegionDownloader } = await import('./maps/RegionDownloader')
    const downloader = getRegionDownloader()

    regionDownloadAbort = { aborted: false }

    return downloader.downloadRegion(
      name,
      bounds,
      minZoom,
      maxZoom,
      (progress) => {
        event.sender.send('tiles:regionDownloadProgress', progress)
      },
      regionDownloadAbort
    )
  })

  ipcMain.handle('tiles:cancelRegionDownload', async () => {
    if (regionDownloadAbort) {
      regionDownloadAbort.aborted = true
    }
  })

  ipcMain.handle('tiles:listDownloadedRegions', async () => {
    const { getRegionDownloader } = await import('./maps/RegionDownloader')
    const downloader = getRegionDownloader()
    return downloader.listDownloadedRegions()
  })

  ipcMain.handle('tiles:getRegionOutputDir', async () => {
    const { getRegionDownloader } = await import('./maps/RegionDownloader')
    const downloader = getRegionDownloader()
    return downloader.getOutputDir()
  })

  // Elevation: Bodenhoehe aus HGT-Dateien
  ipcMain.handle('elevation:getElevation', async (_: any, lat: number, lon: number) => {
    return elevationManager?.getElevation(lat, lon) ?? null
  })

  ipcMain.handle('elevation:getElevations', async (_: any, coords: { lat: number; lon: number }[]) => {
    return elevationManager?.getElevations(coords) ?? []
  })

  ipcMain.handle('elevation:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'HGT Hoehenmodell importieren (ZIP)',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return null
    const results = []
    for (const zipPath of result.filePaths) {
      results.push(await elevationManager!.importFromZip(zipPath))
    }
    return results
  })

  ipcMain.handle('elevation:status', async () => {
    return {
      tiles: elevationManager?.getLoadedTiles() ?? [],
      hgtDir: elevationManager?.hgtDir ?? ''
    }
  })

  // System: Fullscreen toggle
  ipcMain.handle('system:toggleFullscreen', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const isFullScreen = mainWindow.isFullScreen()
      mainWindow.setFullScreen(!isFullScreen)
      return !isFullScreen
    }
    return false
  })

  ipcMain.handle('system:isFullscreen', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.isFullScreen()
    }
    return false
  })

  // System: Open external URL in default browser
  const { shell } = require('electron')
  const os = require('os')

  ipcMain.handle('system:openExternal', async (_: any, url: string, trackData?: string) => {
    console.log('[openExternal] url:', url, 'trackData length:', trackData ? trackData.length : 'undefined')
    try {
      // Track Viewer: eigenes Fenster oeffnen (kein shell.openExternal Limit)
      if (url.includes('track-viewer-3d.html') && trackData) {
        const tempDir = os.tmpdir()

        // Template-Datei finden - mehrere Pfade probieren
        const candidates = [
          path.join(process.cwd(), 'src', 'renderer', 'public', 'track-viewer-3d.html'),
          path.join(__dirname, '../renderer', 'track-viewer-3d.html'),
          path.join(__dirname, '../../src/renderer/public', 'track-viewer-3d.html')
        ]
        let templatePath = ''
        for (const c of candidates) {
          if (fs.existsSync(c)) { templatePath = c; break }
        }
        if (!templatePath) {
          console.error('[3D Viewer] Template nicht gefunden in:', candidates)
          throw new Error('track-viewer-3d.html nicht gefunden')
        }

        let htmlContent = fs.readFileSync(templatePath, 'utf8')

        // HGT-Bodenhoehe am Startpunkt abfragen fuer exakten Terrain-Offset
        let groundMslHeight = 0
        try {
          const parsed = JSON.parse(trackData)
          const firstPoint = parsed.track?.[0]
          console.log('[3D Viewer] firstPoint:', firstPoint ? `lat=${firstPoint.lat}, lon=${firstPoint.lon}` : 'null')
          console.log('[3D Viewer] elevationManager:', elevationManager ? 'vorhanden' : 'null')
          if (firstPoint && elevationManager) {
            const hasTile = elevationManager.hasTile(firstPoint.lat, firstPoint.lon)
            console.log('[3D Viewer] HGT-Kachel vorhanden:', hasTile)
            const elev = elevationManager.getElevation(firstPoint.lat, firstPoint.lon)
            console.log('[3D Viewer] getElevation Ergebnis:', elev)
            if (elev !== null) {
              groundMslHeight = elev
              console.log('[3D Viewer] HGT Bodenhoehe am Start:', groundMslHeight, 'm')
            }
          }
        } catch (err) {
          console.error('[3D Viewer] Fehler beim HGT-Lookup:', err)
        }

        // Track-Daten direkt ins HTML einbetten
        const trackDataScript = `
        // Embedded track data (injected by Electron)
        const embeddedTrackData = ${trackData};
        const embeddedGroundMslHeight = ${groundMslHeight};
        localStorage.setItem('nta_track_data', JSON.stringify(embeddedTrackData));
        console.log('Track data embedded:', embeddedTrackData.track ? embeddedTrackData.track.length : 0, 'points, ground MSL:', embeddedGroundMslHeight, 'm');
        `
        htmlContent = htmlContent.replace('// Initialize when page loads', trackDataScript + '\n        // Initialize when page loads')

        const tempFile = path.join(tempDir, 'nta-track-viewer-3d.html')
        fs.writeFileSync(tempFile, htmlContent, 'utf8')

        // Eigenes BrowserWindow oeffnen (kein URL-Laengenlimit, kein shell.openExternal)
        const viewerWindow = new BrowserWindow({
          width: 1200,
          height: 800,
          title: 'NTA - 3D Track Viewer',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
          }
        })
        viewerWindow.setMenuBarVisibility(false)
        viewerWindow.loadFile(tempFile)
        return
      }

      // Andere URLs: shell.openExternal
      let fullUrl = url
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        if (process.env.NODE_ENV === 'development') {
          fullUrl = `http://localhost:5173/${url}`
        } else {
          const htmlPath = path.join(__dirname, '../renderer', url)
          fullUrl = `file://${htmlPath}`
        }
      }
      await shell.openExternal(fullUrl)
    } catch (error: any) {
      console.error('Error opening external URL:', error)
      throw error
    }
  })

  // Dialog: Native MessageBox
  const { dialog } = require('electron')

  ipcMain.handle('dialog:showMessageBox', async (_: any, options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons: string[]
    defaultId?: number
    cancelId?: number
  }) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: options.type || 'question',
      title: options.title || 'NTA',
      message: options.message,
      detail: options.detail,
      buttons: options.buttons,
      defaultId: options.defaultId ?? 0,
      cancelId: options.cancelId ?? options.buttons.length - 1
    })
    return result.response
  })

  // Dialog: Ordner auswählen
  ipcMain.handle('dialog:selectFolder', async (_: any, options: {
    title?: string
  }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Ordner auswählen',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  // === Update: Download und Installation ===
  ipcMain.handle('update:downloadAndInstall', async (_: any, url: string) => {
    const https = require('https')
    const http = require('http')
    const fs = require('fs')
    const { app } = require('electron')

    const tempDir = app.getPath('temp')
    const filePath = path.join(tempDir, 'NTA-Update.exe')

    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http

      const followRedirects = (downloadUrl: string, redirectCount: number = 0) => {
        if (redirectCount > 5) {
          resolve({ success: false, error: 'Zu viele Weiterleitungen' })
          return
        }

        protocol.get(downloadUrl, (response: any) => {
          // Handle redirects (GitHub releases redirect)
          if (response.statusCode === 301 || response.statusCode === 302) {
            followRedirects(response.headers.location, redirectCount + 1)
            return
          }

          if (response.statusCode !== 200) {
            resolve({ success: false, error: `HTTP ${response.statusCode}` })
            return
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10)
          let downloaded = 0

          const file = fs.createWriteStream(filePath)
          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            file.write(chunk)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update:progress', {
                percent: totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0,
                transferred: downloaded,
                total: totalSize
              })
            }
          })

          response.on('end', () => {
            file.end(() => {
              // Installer starten und App beenden
              const { spawn } = require('child_process')
              spawn(filePath, ['/S'], { detached: true, stdio: 'ignore' }).unref()
              setTimeout(() => app.quit(), 1000)
              resolve({ success: true })
            })
          })

          response.on('error', (err: Error) => {
            file.end()
            resolve({ success: false, error: err.message })
          })
        }).on('error', (err: Error) => {
          resolve({ success: false, error: err.message })
        })
      }

      followRedirects(url)
    })
  })

  // Datei in Ordner speichern
  ipcMain.handle('files:saveToFolder', async (_: any, options: {
    folderPath: string
    fileName: string
    content: string
  }) => {
    try {
      const filePath = path.join(options.folderPath, options.fileName)
      const fs = require('fs')
      fs.writeFileSync(filePath, options.content, 'utf-8')
      return { success: true, path: filePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // Backup automatisch in App-Ordner speichern (kein Dialog)
  ipcMain.handle('files:saveBackup', async (_: any, options: {
    fileName: string
    content: string
  }) => {
    try {
      const fs = require('fs')
      const backupDir = path.join(app.getPath('userData'), 'backups')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }
      const filePath = path.join(backupDir, options.fileName)
      fs.writeFileSync(filePath, options.content, 'utf-8')
      return { success: true, path: filePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', async () => {
  // Cleanup Bluetooth vor dem Beenden
  if (bluetoothManager) {
    await bluetoothManager.cleanup()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Cleanup bei App-Beenden (z.B. durch Strg+C oder Fenster schließen)
let isCleaningUp = false
app.on('before-quit', async (event: Electron.Event) => {
  if (bluetoothManager && !isCleaningUp) {
    isCleaningUp = true
    event.preventDefault()
    await bluetoothManager.cleanup()
    app.exit(0)
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
