// Window API Typen für den Renderer

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

declare global {
  interface Window {
    ntaAPI: {
      bluetooth: {
        scan: () => Promise<BluetoothDevice[]>
        connect: (deviceId: string) => Promise<{ success: boolean; error: string | null }>
        disconnect: () => Promise<void>
        onError: (callback: (error: { message: string; details?: string }) => void) => void
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
        saveToFolder: (options: { folderPath: string; fileName: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>
        saveBackup: (options: { fileName: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>
      }
      maps: {
        import: () => Promise<MapInfo | null>
        importWithImage: (mapPath: string, imagePath: string) => Promise<MapInfo | null>
        list: () => Promise<MapInfo[]>
        remove: (mapId: string) => Promise<boolean>
        getImagePath: (mapId: string) => Promise<string>
        getImageDataUrl: (mapId: string) => Promise<string>
        getTileInfo: (mapId: string) => Promise<{
          tileUrl: string
          imageUrl: string
          bounds: { north: number; south: number; east: number; west: number }
          maxZoom: number
          minZoom: number
          tileSize: number
          imageWidth: number
          imageHeight: number
        } | null>
        geoToPixel: (mapId: string, lat: number, lon: number) => Promise<{ x: number; y: number } | null>
        importForChampionship: () => Promise<MapInfo | null>
        getById: (mapId: string) => Promise<MapInfo | null>
        pixelToGeo: (mapId: string, x: number, y: number) => Promise<{ lat: number; lon: number } | null>
        findForLocation: (lat: number, lon: number) => Promise<MapInfo[]>
        selectFiles: () => Promise<{ mapPath: string; imagePath: string } | null>
        updateCalibration: (mapId: string, points: Array<{ pixelX: number; pixelY: number; latitude: number; longitude: number }>) => Promise<boolean>
        hasReprojectedImage: (mapId: string) => Promise<boolean>
        reprojectImage: (mapId: string, onProgress: (message: string, percent: number) => void) => Promise<{ imagePath: string; bounds: { north: number; south: number; east: number; west: number } } | null>
        areTilesCached: (mapId: string) => Promise<boolean>
        prepareTiles: (mapId: string, onProgress: (progress: number, total: number) => void) => Promise<boolean>
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
        saveTile: (provider: string, z: number, x: number, y: number, base64: string) => Promise<void>
        get: (provider: string, z: number, x: number, y: number) => Promise<string | null>
        getBatch: (provider: string, coords: Array<{ z: number; x: number; y: number }>) => Promise<Array<{ z: number; x: number; y: number; dataUrl: string | null }>>
        getStats: () => Promise<{ totalTiles: number; totalSize: number; providers: { [key: string]: number } }>
        getCacheDir: () => Promise<string>
        clear: () => Promise<void>
        // Competition area download
        countForBounds: (points: Array<{ lat: number; lon: number }>, minZoom: number, maxZoom: number) => Promise<{ count: number; estimatedSize: number }>
        downloadForBounds: (urlTemplate: string, provider: string, points: Array<{ lat: number; lon: number }>, minZoom: number, maxZoom: number) => Promise<{
          success: boolean
          tilesDownloaded: number
          tilesCached: number
          tilesFailed: number
          totalSize: number
        }>
        cancelDownload: () => Promise<boolean>
        onDownloadProgress: (callback: (progress: {
          total: number
          downloaded: number
          cached: number
          failed: number
          currentTile: string
        }) => void) => () => void
        // UTM Reprojection
        mergeAndReproject: (
          provider: string,
          points: Array<{ lat: number; lon: number }>,
          zoomLevel: number,
          utmZone: number
        ) => Promise<{
          imagePath: string
          bounds: { north: number; south: number; east: number; west: number }
          utmBounds: { minE: number; maxE: number; minN: number; maxN: number }
        } | null>
        onReprojectProgress: (callback: (progress: { message: string; percent: number }) => void) => () => void
        // Lade reprojiziertes Bild als Data-URL
        getReprojectedImage: (imagePath: string) => Promise<string | null>
        // MBTiles Import
        importMBTiles: (provider: string) => Promise<{
          success: boolean
          tilesImported: number
          tilesSkipped: number
          tilesFailed: number
          totalSize: number
          bounds: { north: number; south: number; east: number; west: number } | null
          minZoom: number
          maxZoom: number
          name: string
        } | null>
        cancelMBTilesImport: () => Promise<boolean>
        onImportMBTilesProgress: (callback: (progress: {
          total: number
          imported: number
          skipped: number
          failed: number
          currentTile: string
          phase: 'reading' | 'importing' | 'done'
        }) => void) => () => void
        // Admin: Region Download (komplette Länder als MBTiles)
        downloadRegion: (
          name: string,
          bounds: { north: number; south: number; east: number; west: number },
          minZoom: number,
          maxZoom: number,
          progressCallback: (progress: {
            total: number
            downloaded: number
            cached: number
            failed: number
            currentTile: string
            bytesDownloaded: number
          }) => void,
          abortSignal: { aborted: boolean }
        ) => Promise<{ success: boolean; outputPath?: string; error?: string }>
        cancelRegionDownload: () => Promise<void>
        listDownloadedRegions: () => Promise<Array<{ name: string; path: string; size: number; created: Date }>>
        getRegionOutputDir: () => Promise<string>
      }
      elevation: {
        getElevation: (lat: number, lon: number) => Promise<number | null>
        status: () => Promise<{ tiles: { name: string }[] }>
        import: () => Promise<{ imported: string[] }[] | null>
      }
      openExternal: (url: string, data?: string) => void
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

export {}
