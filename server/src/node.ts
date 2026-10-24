// Local / any-Node-host entry: `npm run dev` (watches) or `npm start`.
// DATABASE_URL=pglite:            → an in-memory Postgres, for trying it out without Neon (data is lost on exit)
// DATABASE_URL=pglite:./data      → the same, saved in a local folder
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { appFromEnv } from './config'
import type { Sql } from './db'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: use the environment as is.
}

async function localApp(): Promise<ReturnType<typeof createApp>> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('pglite:')) return appFromEnv()
  const { PGlite } = await import('@electric-sql/pglite')
  const dir = url.slice('pglite:'.length) || undefined
  const db = new PGlite(dir)
  await db.exec(readFileSync(join(import.meta.dirname, '..', 'schema.sql'), 'utf8'))
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  console.log(`Using a local PGlite database${dir ? ` in ${dir}` : ' in memory'} (not Neon).`)
  return createApp({ sql, jwtSecret: process.env.JWT_SECRET ?? '' })
}

const app = await localApp()
const port = Number(process.env.PORT) || 8787
serve({ fetch: app.fetch, port }, () => console.log(`Vanity API listening on http://localhost:${port}`))
