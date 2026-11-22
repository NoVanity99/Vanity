// Where the pictures and files sent in Channels are kept: a Cloudflare Worker in front of an R2
// bucket (server/files-worker). Its address is a secret setting (FILES_URL) and never leaves this
// server: apps upload to, and download from, the Vanity server, which passes the bytes along.

export interface FileStore {
  /** Stores part `n` of a file. */
  putPart(id: string, n: number, bytes: Uint8Array): Promise<void>
  /** The whole file as a stream, or null if it isn't there. */
  get(id: string, parts: number): Promise<ReadableStream<Uint8Array> | null>
  remove(id: string, parts: number): Promise<void>
}

/** Each part an app sends (and the store keeps) is this many bytes, except the last. */
export const FILE_PART = 1024 * 1024

export function createFileStore(url: string | undefined, fetchFn: typeof fetch = fetch): FileStore | null {
  const base = url?.trim().replace(/\/+$/, '')
  if (!base || !/^https?:\/\/[^/]+\/[A-Za-z0-9_-]{32,}$/.test(base)) return null
  const at = (id: string, rest = ''): string => `${base}/o/${encodeURIComponent(id)}${rest}`
  return {
    async putPart(id, n, bytes) {
      const r = await fetchFn(at(id, `/${n}`), { method: 'PUT', body: bytes as never })
      if (!r.ok) throw new Error(`file store: HTTP ${r.status}`)
    },
    async get(id, parts) {
      const r = await fetchFn(at(id, `?parts=${parts}`))
      if (r.status === 404) return null
      if (!r.ok || !r.body) throw new Error(`file store: HTTP ${r.status}`)
      return r.body as ReadableStream<Uint8Array>
    },
    async remove(id, parts) {
      const r = await fetchFn(at(id, `?parts=${Math.max(1, parts)}`), { method: 'DELETE' })
      if (!r.ok && r.status !== 404) throw new Error(`file store: HTTP ${r.status}`)
    }
  }
}
