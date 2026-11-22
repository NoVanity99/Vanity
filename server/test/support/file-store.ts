// The real file-store Worker (server/files-worker/worker.js) running in this process on a
// pretend bucket, so tests exercise the same code that runs on Cloudflare.
import { handle } from '../../files-worker/worker.js'
import { createFileStore, type FileStore } from '../../src/files'

export function workerFileStore(): { store: FileStore; bucket: Map<string, Uint8Array>; key: string } {
  const bucket = new Map<string, Uint8Array>()
  const key = 'k'.repeat(40)
  const env = {
    KEY: key,
    BUCKET: {
      put: async (k: string, v: ArrayBuffer) => void bucket.set(k, new Uint8Array(v)),
      get: async (k: string) => (bucket.has(k) ? { body: new Blob([bucket.get(k)!]).stream() } : null),
      delete: async (keys: string[]) => keys.forEach((k) => bucket.delete(k))
    }
  }
  const store = createFileStore(`http://files.test/${key}`, ((url: string, init?: RequestInit) => handle(new Request(url, init), env)) as typeof fetch)!
  return { store, bucket, key }
}
