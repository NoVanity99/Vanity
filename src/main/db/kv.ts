import type { Db } from './database'

/** Small named values kept in the database (JSON). */
export interface Kv {
  get<T>(key: string): T | null
  set(key: string, value: unknown): void
  delete(key: string): void
}

export function createKv(db: Db, now: () => number = Date.now): Kv {
  const get = db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?')
  const set = db.prepare<[string, string, number]>('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
  const del = db.prepare<[string]>('DELETE FROM kv WHERE key = ?')
  return {
    get<T>(key: string): T | null {
      const row = get.get(key)
      if (!row) return null
      try {
        return JSON.parse(row.value) as T
      } catch {
        return null
      }
    },
    set: (key, value) => void set.run(key, JSON.stringify(value), now()),
    delete: (key) => void del.run(key)
  }
}
