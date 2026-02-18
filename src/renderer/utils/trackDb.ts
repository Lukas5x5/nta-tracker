// IndexedDB Storage für Track-Daten (zu groß für localStorage)
const DB_NAME = 'nta-track-db'
const DB_VERSION = 1
const STORE_NAME = 'trackData'

let dbInstance: IDBDatabase | null = null
let dbFailed = false

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  if (dbFailed) return Promise.reject(new Error('TrackDB disabled'))

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => {
        dbInstance = request.result
        dbInstance.onclose = () => { dbInstance = null }
        resolve(dbInstance)
      }
      request.onerror = () => {
        // DB korrupt: löschen und neu versuchen
        try {
          const delReq = indexedDB.deleteDatabase(DB_NAME)
          delReq.onsuccess = () => {
            const retry = indexedDB.open(DB_NAME, DB_VERSION)
            retry.onupgradeneeded = () => {
              const db = retry.result
              if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME)
              }
            }
            retry.onsuccess = () => {
              dbInstance = retry.result
              dbInstance.onclose = () => { dbInstance = null }
              resolve(dbInstance)
            }
            retry.onerror = () => { dbFailed = true; reject(retry.error) }
          }
          delReq.onerror = () => { dbFailed = true; reject(request.error) }
        } catch {
          dbFailed = true
          reject(request.error)
        }
      }
    } catch (e) {
      dbFailed = true
      reject(e)
    }
  })
}

export async function saveTrackData(track: any[], trackLine: [number, number][]): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(track, 'track')
    store.put(trackLine, 'trackLine')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (e) {
    console.warn('[TrackDB] Save failed:', e)
  }
}

export async function loadTrackData(): Promise<{ track: any[]; trackLine: [number, number][] }> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const trackReq = store.get('track')
    const lineReq = store.get('trackLine')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    return {
      track: trackReq.result || [],
      trackLine: lineReq.result || []
    }
  } catch (e) {
    console.warn('[TrackDB] Load failed:', e)
    return { track: [], trackLine: [] }
  }
}

export async function clearTrackData(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (e) {
    console.warn('[TrackDB] Clear failed:', e)
  }
}
