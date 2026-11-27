import { neon } from '@neondatabase/serverless'
import { schemaStatements } from './schema'

export type Row = Record<string, unknown>

/** A tagged-template SQL runner: sql`SELECT ... WHERE id = ${id}` → rows. Values are always sent as parameters. */
export type Sql = <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>

/** Neon's serverless HTTP driver (works on Vercel and any Node host). */
export function neonSql(databaseUrl: string): Sql {
  const run = neon(databaseUrl)
  return (strings, ...values) => run(strings, ...values) as never
}

/** Creates Vanity's tables on a Neon database if they aren't there yet. */
export function neonMigrate(databaseUrl: string): () => Promise<void> {
  const run = neon(databaseUrl)
  return async () => {
    for (const statement of schemaStatements()) await run.query(statement)
  }
}

// ---- pictures, fetched from the database once ----
// Profile pictures and Channel icons are stored in their rows as text (up to ~60 KB each), and
// the apps ask for lists of people and Channels every few seconds. Reading the pictures out of
// the database on every one of those requests moved gigabytes a month for data that almost
// never changes. So queries select a short reference instead (the `avatar_ref` / `icon_ref`
// columns: "ref:" + the picture's md5, kept by the database itself), and this wrapper swaps each
// reference for the picture from memory, reading it from the database only the first time it
// is seen. A changed picture has a different reference, so nothing here ever goes stale.

const PICTURE_COLUMNS = ['avatar', 'icon'] as const
const MAX_PICTURE_BYTES = 48 * 1024 * 1024

export function withPictures(sql: Sql): Sql {
  const cache = new Map<string, string>()
  let bytes = 0
  const remember = (ref: string, data: string): void => {
    if (cache.has(ref)) return
    cache.set(ref, data)
    bytes += data.length
    // Oldest out first (a Map keeps the order things were put in).
    for (const [old, value] of cache) {
      if (bytes <= MAX_PICTURE_BYTES) break
      cache.delete(old)
      bytes -= value.length
    }
  }
  return async (strings, ...values) => {
    const rows = (await sql(strings, ...values)) as Row[]
    let missing: Set<string> | null = null
    const each = (fn: (row: Row, key: string, ref: string) => void): void => {
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        for (const key of PICTURE_COLUMNS) {
          const v = row[key]
          if (typeof v === 'string' && v.startsWith('ref:')) fn(row, key, v)
        }
      }
    }
    each((row, key, ref) => {
      const hit = cache.get(ref)
      if (hit !== undefined) row[key] = hit
      else (missing ??= new Set()).add(ref)
    })
    if (missing) {
      const refs = [...missing]
      const found = await sql<{ ref: string; data: string }>`
        SELECT avatar_ref AS ref, avatar AS data FROM vanity.profiles WHERE avatar_ref = ANY(${refs}::text[])
        UNION ALL SELECT icon_ref AS ref, icon AS data FROM vanity.communities WHERE icon_ref = ANY(${refs}::text[])`
      for (const f of found) if (typeof f.data === 'string') remember(f.ref, f.data)
      // One that changed in the instant between the two reads is simply left out this time.
      each((row, key, ref) => (row[key] = cache.get(ref) ?? null))
    }
    return rows as never
  }
}
