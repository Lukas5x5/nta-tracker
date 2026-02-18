import { contextBridge, ipcRenderer } from 'electron'

// Typen für die API
interface GPSData {
  latitude: number
  longitude: number
  altitude: number
  speed: number
  heading: number
  timestamp: Date
  satellites: number
  hdop: number
}

interface BaroData {
  pressureAltitude: number
  qnh: number
  variometer: number
  timestamp: Date
}

interface BluetoothDevice {
  id: string
  name: string
  rssi: number
}

interface MapInfo {
  id: string
  name: string
  filename: string
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  imageWidth: number
  imageHeight: number
  isLoaded: boolean
  imagePath: string
  cornerPoints?: {
    topLeft: { lat: number; lon: number }
    topRight: { lat: number; lon: number }
    bottomRight: { lat: number; lon: number }
    bottomLeft: { lat: number; lon: number }
  }
}

// Exponiere sichere APIs an den Renderer
contextBridge.exposeInMainWorld('ntaAPI', {
  // Bluetooth Funktionen
  bluetooth: {
    scan: (): Promise<BluetoothDevice[]> => ipcRenderer.invoke('bluetooth:scan'),
    connect: (deviceId: string): Promise<{ success: boolean; error: string | null }> => ipcRenderer.invoke('bluetooth:connect', deviceId),
    disconnect: (): Promise<void> => ipcRenderer.invoke('bluetooth:disconnect'),
    onError: (callback: (error: { message: string; details?: string }) => void) => {
      ipcRenderer.on('bluetooth:error', (_, error) => callback(error))
    },
    onDisconnected: (callback: () => void) => {
      ipcRenderer.on('bluetooth:disconnected', () => callback())
    },
    offDisconnected: (callback: () => void) => {
      ipcRenderer.removeListener('bluetooth:disconnected', callback as any)
    },
    onDebug: (callback: (stats: any) => void) => {
      ipcRenderer.on('bluetooth:debug', (_, stats) => callback(stats))
    },
    offDebug: () => {
      ipcRenderer.removeAllListeners('bluetooth:debug')
    }
  },

  // GPS Daten
  gps: {
    subscribe: (callback: (data: GPSData) => void) => {
      ipcRenderer.send('gps:subscribe')
      ipcRenderer.on('gps:data', (_, data) => callback(data))
    },
    unsubscribe: () => {
      ipcRenderer.removeAllListeners('gps:data')
    }
  },

  // Barometer Daten
  baro: {
    subscribe: (callback: (data: BaroData) => void) => {
      ipcRenderer.send('baro:subscribe')
      ipcRenderer.on('baro:data', (_, data) => callback(data))
    },
    unsubscribe: () => {
      ipcRenderer.removeAllListeners('baro:data')
    }
  },

  // Datei Operationen
  files: {
    saveIGC: (data: string, filename: string): Promise<string> =>
      ipcRenderer.invoke('files:saveIGC', data, filename),
    loadWaypoints: (filepath: string): Promise<any[]> =>
      ipcRenderer.invoke('files:loadWaypoints', filepath),
    saveFlightReport: (report: any): Promise<string> =>
      ipcRenderer.invoke('files:saveFlightReport', report),
    saveToFolder: (options: { folderPath: string; fileName: string; content: string }): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('files:saveToFolder', options),
    saveBackup: (options: { fileName: string; content: string }): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('files:saveBackup', options)
  },

  // Karten Management (OZF Format)
  maps: {
    import: (): Promise<MapInfo | null> =>
      ipcRenderer.invoke('maps:import'),
    importWithImage: (mapPath: string, imagePath: string): Promise<MapInfo | null> =>
      ipcRenderer.invoke('maps:importWithImage', mapPath, imagePath),
    list: (): Promise<MapInfo[]> =>
      ipcRenderer.invoke('maps:list'),
    remove: (mapId: string): Promise<boolean> =>
      ipcRenderer.invoke('maps:remove', mapId),
    getImagePath: (mapId: string): Promise<string> =>
      ipcRenderer.invoke('maps:getImagePath', mapId),
    getImageDataUrl: (mapId: string): Promise<string> =>
      ipcRenderer.invoke('maps:getImageDataUrl', mapId),
    getTileInfo: (mapId: string): Promise<{
      tileUrl: string
      imageUrl: string
      bounds: { north: number; south: number; east: number; west: number }
      maxZoom: number
      minZoom: number
      tileSize: number
      imageWidth: number
      imageHeight: number
    } | null> =>
      ipcRenderer.invoke('maps:getTileInfo', mapId),
    geoToPixel: (mapId: string, lat: number, lon: number): Promise<{ x: number; y: number } | null> =>
      ipcRenderer.invoke('maps:geoToPixel', mapId, lat, lon),
    pixelToGeo: (mapId: string, x: number, y: number): Promise<{ lat: number; lon: number } | null> =>
      ipcRenderer.invoke('maps:pixelToGeo', mapId, x, y),
    geoToDisplayCoord: (mapId: string, lat: number, lon: number): Promise<{ lat: number; lon: number } | null> =>
      ipcRenderer.invoke('maps:geoToDisplayCoord', mapId, lat, lon),
    findForLocation: (lat: number, lon: number): Promise<MapInfo[]> =>
      ipcRenderer.invoke('maps:findForLocation', lat, lon),
    selectFiles: (): Promise<{ mapPath: string; imagePath: string } | null> =>
      ipcRenderer.invoke('maps:selectFiles'),
    updateCalibration: (mapId: string, points: Array<{ pixelX: number; pixelY: number; latitude: number; longitude: number }>): Promise<boolean> =>
      ipcRenderer.invoke('maps:updateCalibration', mapId, points),
    prepareTiles: (mapId: string, onProgress: (progress: number, total: number) => void): Promise<boolean> =>
      new Promise((resolve, reject) => {
        const channel = `maps:prepareTiles:progress:${mapId}`
        const handler = (_event: any, progress: number, total: number) => {
          onProgress(progress, total)
        }
        ipcRenderer.on(channel, handler)
        ipcRenderer.invoke('maps:prepareTiles', mapId)
          .then((result) => {
            ipcRenderer.removeListener(channel, handler)
            resolve(result)
          })
          .catch((err) => {
            ipcRenderer.removeListener(channel, handler)
            reject(err)
          })
      }),
    areTilesCached: (mapId: string): Promise<boolean> =>
      ipcRenderer.invoke('maps:areTilesCached', mapId),
    // Importiere Karte für Meisterschaft (gibt Map-ID zurück)
    importForChampionship: (): Promise<MapInfo | null> =>
      ipcRenderer.invoke('maps:importForChampionship'),
    // Hole Karte nach ID
    getById: (mapId: string): Promise<MapInfo | null> =>
      ipcRenderer.invoke('maps:getById', mapId),
    // Prüfe ob reprojiziertes Bild existiert (altes System)
    hasReprojectedImage: (mapId: string): Promise<boolean> =>
      ipcRenderer.invoke('maps:hasReprojectedImage', mapId),
    // Reprojiziere Bild (altes System - deprecated)
    reprojectImage: (mapId: string, onProgress: (message: string, percent: number) => void): Promise<{ imagePath: string; bounds: { north: number; south: number; east: number; west: number } } | null> =>
      new Promise((resolve, reject) => {
        const channel = `maps:reprojectImage:progress:${mapId}`
        const handler = (_event: any, message: string, percent: number) => {
          onProgress(message, percent)
        }
        ipcRenderer.on(channel, handler)
        ipcRenderer.invoke('maps:reprojectImage', mapId)
          .then((result) => {
            ipcRenderer.removeListener(channel, handler)
            resolve(result)
          })
          .catch((err) => {
            ipcRenderer.removeListener(channel, handler)
            reject(err)
          })
      }),

    // === NEUES TILE-SYSTEM (exakte Koordinaten wie OziExplorer) ===

    // Prüfe ob Tiles für eine Karte existieren
    hasTiles: (mapId: string): Promise<boolean> =>
      ipcRenderer.invoke('maps:hasTiles', mapId),

    // Hole Tile-Index (enthält alle Tiles mit WGS84-Eckpunkten)
    getTileIndex: (mapId: string): Promise<any> =>
      ipcRenderer.invoke('maps:getTileIndex', mapId),

    // Generiere Tiles für eine Karte (einmalig beim ersten Laden)
    generateTiles: (mapId: string, onProgress: (message: string, percent: number) => void): Promise<any> =>
      new Promise((resolve, reject) => {
        const channel = `maps:generateTiles:progress:${mapId}`
        const handler = (_event: any, message: string, percent: number) => {
          onProgress(message, percent)
        }
        ipcRenderer.on(channel, handler)
        ipcRenderer.invoke('maps:generateTiles', mapId)
          .then((result) => {
            ipcRenderer.removeListener(channel, handler)
            resolve(result)
          })
          .catch((err) => {
            ipcRenderer.removeListener(channel, handler)
            reject(err)
          })
      }),

    // Hole Tile als Data-URL
    getTileDataUrl: (mapId: string, tileX: number, tileY: number): Promise<string | null> =>
      ipcRenderer.invoke('maps:getTileDataUrl', mapId, tileX, tileY),

    // Hole UTM-Kalibrierung für Pixel-basierte Darstellung (OziMapView)
    getUTMCalibration: (mapId: string): Promise<{
      imageWidth: number
      imageHeight: number
      bounds: { north: number; south: number; east: number; west: number }
      utmZone: number
      utmToPixel: { a: number; b: number; c: number; d: number; e: number; f: number }
    } | null> =>
      ipcRenderer.invoke('maps:getUTMCalibration', mapId),

    // Parse Eckpunkte aus .map Datei für Competition Area
    parseCorners: (): Promise<{
      name: string
      utmZone: number
      corners: {
        nw: { lat: number; lon: number }
        no: { lat: number; lon: number }
        so: { lat: number; lon: number }
        sw: { lat: number; lon: number }
      }
    } | null> =>
      ipcRenderer.invoke('maps:parseCorners')
  },

  // Tile Cache für Offline-Karten
  tiles: {
    has: (provider: string, z: number, x: number, y: number): Promise<boolean> =>
      ipcRenderer.invoke('tiles:has', provider, z, x, y),
    get: (provider: string, z: number, x: number, y: number): Promise<string | null> =>
      ipcRenderer.invoke('tiles:get', provider, z, x, y),
    getBatch: (provider: string, coords: Array<{ z: number; x: number; y: number }>): Promise<Array<{ z: number; x: number; y: number; dataUrl: string | null }>> =>
      ipcRenderer.invoke('tiles:getBatch', provider, coords),
    saveTile: (provider: string, z: number, x: number, y: number, base64Data: string): Promise<boolean> =>
      ipcRenderer.invoke('tiles:save', provider, z, x, y, base64Data),
    getStats: (): Promise<{ totalTiles: number; totalSize: number; providers: { [key: string]: number } }> =>
      ipcRenderer.invoke('tiles:stats'),
    clear: (provider?: string): Promise<boolean> =>
      ipcRenderer.invoke('tiles:clear', provider),
    getCacheDir: (): Promise<string> =>
      ipcRenderer.invoke('tiles:getCacheDir'),
    // Competition area download
    countForBounds: (points: Array<{ lat: number; lon: number }>, minZoom: number, maxZoom: number): Promise<{ count: number; estimatedSize: number }> =>
      ipcRenderer.invoke('tiles:countForBounds', points, minZoom, maxZoom),
    downloadForBounds: (urlTemplate: string, provider: string, points: Array<{ lat: number; lon: number }>, minZoom: number, maxZoom: number): Promise<any> =>
      ipcRenderer.invoke('tiles:downloadForBounds', urlTemplate, provider, points, minZoom, maxZoom),
    cancelDownload: (): Promise<boolean> =>
      ipcRenderer.invoke('tiles:cancelDownload'),
    onDownloadProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('tiles:downloadProgress', (_event, progress) => callback(progress))
      return () => ipcRenderer.removeAllListeners('tiles:downloadProgress')
    },
    // Merge tiles and reproject to UTM
    mergeAndReproject: (
      provider: string,
      points: Array<{ lat: number; lon: number }>,
      zoomLevel: number,
      utmZone: number
    ): Promise<{
      imagePath: string
      bounds: { north: number; south: number; east: number; west: number }
      utmBounds: { minE: number; maxE: number; minN: number; maxN: number }
    } | null> =>
      ipcRenderer.invoke('tiles:mergeAndReproject', provider, points, zoomLevel, utmZone),
    onReprojectProgress: (callback: (progress: { message: string; percent: number }) => void) => {
      ipcRenderer.on('tiles:reprojectProgress', (_event, progress) => callback(progress))
      return () => ipcRenderer.removeAllListeners('tiles:reprojectProgress')
    },
    // Lade reprojiziertes Bild als Data-URL
    getReprojectedImage: (imagePath: string): Promise<string | null> =>
      ipcRenderer.invoke('tiles:getReprojectedImage', imagePath),

    // MBTiles Import
    importMBTiles: (provider: string): Promise<{
      success: boolean
      tilesImported: number
      tilesSkipped: number
      tilesFailed: number
      totalSize: number
      bounds: { north: number; south: number; east: number; west: number } | null
      minZoom: number
      maxZoom: number
      name: string
    } | null> =>
      ipcRenderer.invoke('tiles:importMBTiles', provider),
    cancelMBTilesImport: (): Promise<boolean> =>
      ipcRenderer.invoke('tiles:cancelMBTilesImport'),
    onImportMBTilesProgress: (callback: (progress: {
      total: number
      imported: number
      skipped: number
      failed: number
      currentTile: string
      phase: 'reading' | 'importing' | 'done'
    }) => void) => {
      ipcRenderer.on('tiles:importMBTilesProgress', (_event, progress) => callback(progress))
      return () => ipcRenderer.removeAllListeners('tiles:importMBTilesProgress')
    },

    // Admin: Region Download (komplette Länder als MBTiles)
    downloadRegion: (
      name: string,
      bounds: { north: number; south: number; east: number; west: number },
      minZoom: number,
      maxZoom: number,
      progressCallback: (progress: any) => void,
      abortSignal: { aborted: boolean }
    ): Promise<{ success: boolean; outputPath?: string; error?: string }> => {
      // Registriere Progress-Listener
      const removeListener = () => ipcRenderer.removeAllListeners('tiles:regionDownloadProgress')
      ipcRenderer.on('tiles:regionDownloadProgress', (_event, progress) => progressCallback(progress))

      // Starte Download
      return ipcRenderer.invoke('tiles:downloadRegion', name, bounds, minZoom, maxZoom)
        .finally(removeListener)
    },
    cancelRegionDownload: (): Promise<void> =>
      ipcRenderer.invoke('tiles:cancelRegionDownload'),
    listDownloadedRegions: (): Promise<Array<{ name: string; path: string; size: number; created: Date }>> =>
      ipcRenderer.invoke('tiles:listDownloadedRegions'),
    getRegionOutputDir: (): Promise<string> =>
      ipcRenderer.invoke('tiles:getRegionOutputDir')
  },

  // Elevation (HGT Bodenhoehe)
  elevation: {
    getElevation: (lat: number, lon: number): Promise<number | null> =>
      ipcRenderer.invoke('elevation:getElevation', lat, lon),
    getElevations: (coords: { lat: number; lon: number }[]): Promise<(number | null)[]> =>
      ipcRenderer.invoke('elevation:getElevations', coords),
    import: (): Promise<any> =>
      ipcRenderer.invoke('elevation:import'),
    status: (): Promise<{ tiles: string[]; hgtDir: string }> =>
      ipcRenderer.invoke('elevation:status')
  },

  // System Funktionen
  openExternal: (url: string, trackData?: string): Promise<void> =>
    ipcRenderer.invoke('system:openExternal', url, trackData),

  // Fullscreen Funktionen
  toggleFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke('system:toggleFullscreen'),
  isFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke('system:isFullscreen'),

  // Update Funktionen
  update: {
    downloadAndInstall: (url: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:downloadAndInstall', url),
    onProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
      ipcRenderer.on('update:progress', (_event, progress) => callback(progress))
      return () => ipcRenderer.removeAllListeners('update:progress')
    }
  },

  // Dialog Funktionen
  dialog: {
    // Zeigt einen Dialog mit mehreren Buttons und gibt den Index des geklickten Buttons zurück
    showMessageBox: (options: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message: string
      detail?: string
      buttons: string[]
      defaultId?: number
      cancelId?: number
    }): Promise<number> =>
      ipcRenderer.invoke('dialog:showMessageBox', options),

    // Ordner auswählen
    selectFolder: (options: { title?: string }): Promise<string | null> =>
      ipcRenderer.invoke('dialog:selectFolder', options)
  }
})

// TypeScript Deklaration für Window
declare global {
  interface Window {
    ntaAPI: {
      bluetooth: {
        scan: () => Promise<BluetoothDevice[]>
        connect: (deviceId: string) => Promise<{ success: boolean; error: string | null }>
        disconnect: () => Promise<void>
        onError: (callback: (error: { message: string; details?: string }) => void) => void
        onDisconnected: (callback: () => void) => void
        offDisconnected: (callback: () => void) => void
        onDebug: (callback: (stats: any) => void) => void
        offDebug: () => void
      }
      gps: {
        subscribe: (callback: (data: GPSData) => void) => void
        unsubscribe: () => void
      }
      baro: {
        subscribe: (callback: (data: BaroData) => void) => void
        unsubscribe: () => void
      }
      files: {
        saveIGC: (data: string, filename: string) => Promise<string>
        loadWaypoints: (filepath: string) => Promise<any[]>
        saveFlightReport: (report: any) => Promise<string>
      }
      maps: {
        import: () => Promise<MapInfo | null>
        importWithImage: (mapPath: string, imagePath: string) => Promise<MapInfo | null>
        list: () => Promise<MapInfo[]>
        remove: (mapId: string) => Promise<boolean>
        getImagePath: (mapId: string) => Promise<string>
        getImageDataUrl: (mapId: string) => Promise<string>
        geoToPixel: (mapId: string, lat: number, lon: number) => Promise<{ x: number; y: number } | null>
        pixelToGeo: (mapId: string, x: number, y: number) => Promise<{ lat: number; lon: number } | null>
        geoToDisplayCoord: (mapId: string, lat: number, lon: number) => Promise<{ lat: number; lon: number } | null>
        findForLocation: (lat: number, lon: number) => Promise<MapInfo[]>
        selectFiles: () => Promise<{ mapPath: string; imagePath: string } | null>
        updateCalibration: (mapId: string, points: Array<{ pixelX: number; pixelY: number; latitude: number; longitude: number }>) => Promise<boolean>
        parseCorners: () => Promise<{
          name: string
          utmZone: number
          corners: {
            nw: { lat: number; lon: number }
            no: { lat: number; lon: number }
            so: { lat: number; lon: number }
            sw: { lat: number; lon: number }
          }
        } | null>
      }
      tiles: {
        has: (provider: string, z: number, x: number, y: number) => Promise<boolean>
        get: (provider: string, z: number, x: number, y: number) => Promise<string | null>
        saveTile: (provider: string, z: number, x: number, y: number, base64Data: string) => Promise<boolean>
        getStats: () => Promise<{ totalTiles: number; totalSize: number; providers: { [key: string]: number } }>
        clear: (provider?: string) => Promise<boolean>
        getCacheDir: () => Promise<string>
        countForBounds: (points: Array<{ lat: number; lon: number }>, minZoom: number, maxZoom: number) => Promise<{ count: number; estimatedSize: number }>
        downloadForBounds: (urlTemplate: string, provider: string, points: Array<{ lat: number; lon: number }>, minZoom: number, maxZoom: number) => Promise<any>
        cancelDownload: () => Promise<boolean>
        onDownloadProgress: (callback: (progress: any) => void) => () => void
        mergeAndReproject: (provider: string, points: Array<{ lat: number; lon: number }>, zoomLevel: number, utmZone: number) => Promise<any>
        onReprojectProgress: (callback: (progress: { message: string; percent: number }) => void) => () => void
        getReprojectedImage: (imagePath: string) => Promise<string | null>
        // Admin: Region Download
        downloadRegion: (name: string, bounds: { north: number; south: number; east: number; west: number }, minZoom: number, maxZoom: number, progressCallback: (progress: any) => void, abortSignal: { aborted: boolean }) => Promise<{ success: boolean; outputPath?: string; error?: string }>
        cancelRegionDownload: () => Promise<void>
        listDownloadedRegions: () => Promise<Array<{ name: string; path: string; size: number; created: Date }>>
        getRegionOutputDir: () => Promise<string>
      }
      elevation: {
        getElevation: (lat: number, lon: number) => Promise<number | null>
        getElevations: (coords: { lat: number; lon: number }[]) => Promise<(number | null)[]>
        import: () => Promise<any>
        status: () => Promise<{ tiles: string[]; hgtDir: string }>
      }
      openExternal: (url: string, trackData?: string) => Promise<void>
      toggleFullscreen: () => Promise<boolean>
      isFullscreen: () => Promise<boolean>
      update: {
        downloadAndInstall: (url: string) => Promise<{ success: boolean; error?: string }>
        onProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void
      }
      dialog: {
        showMessageBox: (options: {
          type?: 'none' | 'info' | 'error' | 'question' | 'warning'
          title?: string
          message: string
          detail?: string
          buttons: string[]
          defaultId?: number
          cancelId?: number
        }) => Promise<number>
        selectFolder: (options: { title?: string }) => Promise<string | null>
      }
    }
  }
}
