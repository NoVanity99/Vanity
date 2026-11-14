// Saves the library database (a single file's worth of bytes) in the app's IndexedDB storage.

const DB_NAME = 'vanity'
const STORE = 'files'
const KEY = 'vanity.db'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadDatabase(): Promise<Uint8Array | null> {
  try {
    const idb = await open()
    return await new Promise((resolve, reject) => {
      const req = idb.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.error('[db] could not read the saved library:', err)
    return null
  }
}

export async function saveDatabase(bytes: Uint8Array): Promise<void> {
  const idb = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(bytes, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Saves shortly after changes stop (so a burst of writes is one save), and
 * straight away when the app goes to the background, since Android may close it there.
 */
export function createSaver(getBytes: () => Uint8Array, delayMs = 400): { schedule(): void; flush(): Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  const flush = async (): Promise<void> => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    pending = false
    try {
      await saveDatabase(getBytes())
    } catch (err) {
      pending = true
      console.error('[db] save failed:', err)
    }
  }
  const schedule = (): void => {
    pending = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), delayMs)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
  window.addEventListener('pagehide', () => void flush())
  return { schedule, flush }
}
